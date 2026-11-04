import json
from datetime import date, datetime, timezone

import pytest

from scraper import soc
from scraper.fetch import FetchError, HTTPStatusError, Page


def page_json(courses, total, retrieved, cursor):
    return [{"COURSES": courses, "TOTALROWS": total, "RETRIEVEDROWS": retrieved, "LASTCONTROLNUMBER": cursor}]


COURSE = {
    "code": "FOR4911", "courseId": "026968", "name": "Research", "description": "x",
    "prerequisites": "Credits: 2; Prereq: senior standing. Coreq: FOR 4910.",
    "sections": [{
        "classNumber": 10585, "number": "FOS1", "credits": "VAR", "credits_min": 1, "credits_max": 3,
        "acadCareer": "UGRD", "sectWeb": "AD", "instructors": [{"name": "A Person"}, {"name": " "}],
        "genEd": ["Biological Science", "International"], "quest": ["QUEST 3"],
        "elalAttr": "Independent Study", "aiAttr": None, "rotateTitle": "", "deptName": "Forestry",
    }],
}


class FakeFetcher:
    """Serves a fixed list of responses in order, like the SOC cursor chain."""
    default_ttl = None

    def __init__(self, responses):
        self.responses = list(responses)

    def get_json(self, url, params=None, *, ttl=None):
        return Page(url, json.dumps(self.responses.pop(0)), datetime.now(timezone.utc), from_cache=True)


def test_split_requisite_text_separates_labeled_parts():
    assert soc.split_requisite_text(COURSE["prerequisites"]) == ("senior standing.", "FOR 4910.")
    assert soc.split_requisite_text("Can be taken concurrently with SPN 2240.") == (
        "Can be taken concurrently with SPN 2240.", "")


def test_parse_page_reads_course_and_section_fields():
    listings, sections, paging = soc.parse_page(page_json([COURSE], 1, 1, 7), "2218", "CWSP", page=None)
    (listing,), (s,) = listings, sections
    assert (listing.course_id, listing.uf_course_id, listing.coreq_text) == ("for4911", "026968", "FOR 4910.")
    assert (s.credits_min, s.credits_max, s.instructors) == (1.0, 3.0, ["A Person"])
    assert (s.gen_ed, s.quest, s.elal) == (["biological", "international"], ["quest3"], "Independent Study")
    assert paging == {"total": 1, "retrieved": 1, "cursor": 7, "courses": 1}


def test_shape_change_fails_loudly():
    with pytest.raises(FetchError, match="shape changed"):
        soc.parse_page([{"courses": []}], "2218", "CWSP", page=None)


def test_collect_term_follows_the_cursor_until_every_row_is_retrieved():
    fetcher = FakeFetcher([page_json([COURSE], 2, 1, 5), page_json([COURSE], 2, 1, 9),  # CWSP
                           page_json([], 0, 0, 0)])                                       # UFOL: empty
    result = soc.collect_term(fetcher, "2218", closed=True)
    assert len(result.pages) == 3
    assert len(result.sections) == 1  # the same class number twice is one section


def test_a_broken_cursor_chain_raises_instead_of_truncating():
    fetcher = FakeFetcher([page_json([COURSE], 5, 1, 5), page_json([COURSE], 5, 1, 5)])
    with pytest.raises(FetchError, match="pagination stopped at 2 of 5"):
        soc.collect_term(fetcher, "2218", closed=True)


def test_terms_close_after_they_end():
    assert soc.is_closed("2218", date(2026, 10, 3))        # Fall 2021
    assert not soc.is_closed("2268", date(2026, 10, 3))    # Fall 2026, in progress
    assert not soc.is_closed("2271", date(2026, 10, 3))    # Spring 2027, not started


class FailingFetcher(FakeFetcher):
    """Serves the scripted pages, then fails the way UF's server did on 2221."""

    def __init__(self, responses, status):
        super().__init__(responses)
        self.status = status

    def get_json(self, url, params=None, *, ttl=None):
        if not self.responses:
            raise HTTPStatusError(self.status, url)
        return super().get_json(url, params, ttl=ttl)


def test_a_server_error_keeps_the_term_but_marks_it_incomplete():
    fetcher = FailingFetcher([page_json([COURSE], 5, 1, 5)], status=500)
    result = soc.collect_term(fetcher, "2221", closed=True)
    assert len(result.sections) == 1
    assert not result.complete
    assert "CWSP: stopped after 1 pages" in result.problems[0]


def test_a_client_error_still_stops_the_run():
    fetcher = FailingFetcher([], status=404)
    with pytest.raises(HTTPStatusError):
        soc.collect_term(fetcher, "2221", closed=True)


def test_a_zero_credit_minimum_is_kept_not_treated_as_missing():
    # SOC's shape for 0-3 credit research sections: min 0, "credits" VAR.
    zero = dict(COURSE, sections=[dict(COURSE["sections"][0], credits="VAR", credits_min=0, credits_max=3)])
    _, (s,), _ = soc.parse_page(page_json([zero], 1, 1, 7), "2218", "CWSP", page=None)
    assert (s.credits_min, s.credits_max) == (0.0, 3.0)
