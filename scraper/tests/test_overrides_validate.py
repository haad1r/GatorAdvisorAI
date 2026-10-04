import pytest

from scraper import catalog
from scraper.overrides import OverrideError, apply_overrides
from scraper.validate import ValidationError, validate_catalog


def make(cid, prereq=None, **fields):
    course = catalog.Course(id=cid, code=cid.upper(), name="x", credits_min=3, credits_max=3,
                            description="", grading="letter", **fields)
    course.prereq = catalog.parse_requisite(prereq) if prereq else None
    return course


def test_every_override_needs_a_reason():
    courses = {"mac2311": make("mac2311")}
    with pytest.raises(OverrideError):
        apply_overrides(courses, {"courses": {"mac2311": {"credits_min": 4}}})


def test_requisite_override_is_reparsed_and_reason_recorded():
    courses = {"mac2312": make("mac2312", "Instructor permission"), "mac2311": make("mac2311")}
    reasons = apply_overrides(courses, {"requisites": {
        "mac2312": {"reason": "catalog typo", "prereq": "MAC 2311 with minimum grade of C"}}})
    assert courses["mac2312"].prereq.tree == {"type": "course", "course_id": "mac2311", "min_grade": "C"}
    assert reasons == {"mac2312": "catalog typo"}


def test_lab_suffix_reference_is_resolved_and_counted():
    courses = {"cop3503c": make("cop3503c"), "cop3530": make("cop3530", "COP 3503")}
    report = validate_catalog(courses)
    assert courses["cop3530"].prereq.tree["course_id"] == "cop3503c"
    assert report["resolved_lab_suffix"]["count"] == 1


def test_unknown_references_are_reported_not_removed():
    courses = {"cop3530": make("cop3530", "XYZ 9999")}
    report = validate_catalog(courses)
    assert courses["cop3530"].prereq.tree["course_id"] == "xyz9999"
    assert report["unknown_course_references"]["count"] == 1


def test_values_outside_the_vocabulary_stop_the_run():
    with pytest.raises(ValidationError):
        validate_catalog({"mac2311": make("mac2311", gen_ed=["math"])})
