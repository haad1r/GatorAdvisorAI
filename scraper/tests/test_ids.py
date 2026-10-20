from scraper import ids


def test_code_to_id_strips_all_whitespace():
    assert ids.code_to_id("COP 3502C") == "cop3502c"
    assert ids.code_to_id("COP\u00a03502C") == "cop3502c"  # non-breaking space from HTML
    assert ids.id_to_code("cop3502c") == "COP 3502C"


def test_find_course_ids_keeps_order_and_ignores_lowercase():
    text = "MAC 2311 or MAC2312, and then MAC 2311 again; the 2000 words"
    assert ids.find_course_ids(text) == ["mac2311", "mac2312"]


def test_term_codes():
    assert ids.term_code(2021, "fall") == "2218"
    assert ids.term_name("2271") == "Spring 2027"
    assert ids.next_term("2218") == "2221"   # fall -> next year's spring
    assert not ids.is_term_code("22656W1")   # summer sub-term


def test_terms_between_covers_our_backfill():
    terms = ids.terms_between("2218", "2271")
    assert len(terms) == 17
    assert terms[:3] == ["2218", "2221", "2225"]
    assert terms[-1] == "2271"


def test_gen_ed_labels_from_every_source_agree():
    assert ids.gen_ed_from_label("Biological Science") == "biological"      # SOC + catalog
    assert ids.gen_ed_from_label("social and behavioral sciences") == "social"
    assert ids.gen_ed_from_letter("P") == "physical"                       # exam credit
    assert ids.gen_ed_from_label("Ethics") is None                         # unknown -> None


def test_quest_labels_include_quest_3():
    assert ids.quest_from_label("QUEST 1") == "quest1"
    assert ids.quest_from_label("Quest 2") == "quest2"
    assert ids.quest_from_label("3rd Year UF Quest") == "quest3"