# GatorAdvisor Interest List (draft v1)

**Author:** Alan (@fanggs)
**Issue:** #11, steps 1-2
**Version:** `interests_v1`

**Purpose:** a short list of broad interests that works for every UF student. The
survey uses it, and courses get tagged with it, so interest matching can rank
course recommendations (electives and course discovery).

**Each interest has two names:**
- **ID** (internal, never changes): stored with survey answers, tags, and feedback
- **Display text** (what students see): can be reworded freely

IDs are never renamed or reused. Adding or removing an interest bumps the list
version (`interests_v2`, ...), and survey answers record which version they used.

## The list (22 interests, 6 display groups)

| Group | ID | Display text |
|---|---|---|
| Technology & Engineering | `programming_software` | Programming & Software |
| | `ai_data` | AI & Data Science |
| | `engineering_design` | Engineering & Building Things |
| | `construction_planning` | Construction, Cities & Planning |
| Science & Math | `math_physical_sciences` | Math & Physical Sciences |
| | `life_sciences` | Biology & Life Sciences |
| | `environment_agriculture` | Environment, Agriculture & Food |
| | `animals_wildlife` | Animals & Wildlife |
| Health | `health_medicine` | Health & Medicine |
| | `sports_fitness` | Sports, Fitness & Movement |
| Business | `business_management` | Business, Marketing & Entrepreneurship |
| | `finance_accounting` | Finance, Accounting & Economics |
| Arts & Media | `media_communication` | Media, Journalism & Communication |
| | `visual_arts_design` | Art, Design & Architecture |
| | `performing_arts_music` | Music, Theater & Dance |
| | `writing_literature` | Writing & Literature |
| Society & Humanities | `languages_global` | Languages & Global Studies |
| | `history_culture_philosophy` | History, Philosophy & Religion |
| | `politics_law` | Politics & Law |
| | `society_social_sciences` | Society & Social Sciences |
| | `psychology_behavior` | Psychology & Human Behavior |
| | `education_teaching` | Education & Teaching |

Groups are only for laying out the survey screen. They are not used in scoring,
so moving an interest between groups doesn't change any results.

## How it was built

1. Started from UF's official A-Z list of about 190 course subject areas
   (catalog.ufl.edu/UGRD/courses).
2. Grouped similar subjects into broad interests, then named each one.
   The IDs and groupings are my own design, not an official UF list.
3. Checked that every subject area maps to at least one interest. Only
   program labels (Honors, Quest, Career Development, Interdisciplinary Studies)
   and Military Science were left out.

**Limits:** based on subject names, not course descriptions. Wording not yet
tested with students. Full subject-to-interest map in the appendix below.

## How courses get tagged

The subject map in the appendix is the **starting point** for course tags, not
the final tags. Subject-level tags are too coarse on their own: every CIS course
would get only `programming_software`, even an AI course.

1. **Subject default:** every course gets the interests its subject maps to.
2. **Description review:** tags are added or removed from the course
   description (by hand, or model-assisted and then reviewed). These override
   the subject default.

Each tag records where it came from:

```json
{
  "course_id": "CAP4621",
  "interest_id": "ai_data",
  "source": "description_reviewed",
  "interest_list_version": "interests_v1",
  "tag_version": "tags_v1",
  "reviewed_by": "alan"
}
```

`source` is `subject_default` or `description_reviewed`. Q2 in the survey (topics
to avoid) only filters on `description_reviewed` tags, because removing a course
needs more confidence than boosting one.

---

## Appendix: UF subject area -> interest map

Source: UF's A-Z list of course subject areas (catalog.ufl.edu/UGRD/courses).
A subject can appear under more than one interest. These produce the
`subject_default` tags.

- **programming_software**: Computer and Information Science & Engineering,
  Digital Worlds Institute
- **ai_data**: AI | Artificial Intelligence, Statistics, Information Systems
  and Operations Management
- **engineering_design**: Engineering, Agricultural and Biological Engineering,
  Biomedical Engineering, Chemical Engineering, Civil and Coastal Engineering,
  Electrical and Computer Engineering, Environmental Engineering Sciences,
  Industrial and Systems Engineering, Materials Science and Engineering,
  Mechanical & Aerospace Engineering, Nuclear and Radiological Engineering,
  Packaging Science
- **construction_planning**: Construction Management, Urban and Regional
  Planning, Sustainability and the Built Environment
- **math_physical_sciences**: Mathematics, Physics, Astronomy and Astrophysics,
  Chemistry, Geological Sciences
- **life_sciences**: Biology | Botany | Zoology, Botany, Zoology, Biochemistry
  and Molecular Biology, Microbiology & Cell Science, Entomology and
  Nematology, Plant Pathology, Pest Management | Plant Protection
- **environment_agriculture**: Agricultural and Life Sciences | General,
  Agricultural Education and Communication, Agricultural Operations Management,
  Agronomy, Environmental Horticulture, Horticultural Sciences, Soil Water and
  Ecosystem Sciences, Environmental Science, Forest Fisheries and Geomatics
  Sciences, Geomatics, Food and Resource Economics, Food Science and Human
  Nutrition
- **animals_wildlife**: Animal Sciences, Veterinary Medical Sciences, Wildlife
  Ecology and Conservation, Fisheries and Aquatic Sciences
- **health_medicine**: Medicine, Nursing, Pharmacy, Public Health, Health
  Professions, Health Science, Health Education and Behavior, Occupational
  Therapy, Rehabilitative Services, Speech Language and Hearing Sciences,
  Clinical and Health Psychology, Fire and Emergency Services, Food Science
  and Human Nutrition
- **sports_fitness**: Applied Physiology and Kinesiology, Sport Management
- **business_management**: Business, Management, Marketing, Innovation Academy,
  Tourism Hospitality and Event Management
- **finance_accounting**: Accounting, Economics, Finance Insurance and Real
  Estate, Food and Resource Economics
- **media_communication**: Advertising, Journalism, Mass Communication, Public
  Relations, Film and Media Studies, Media Production Management and
  Technology, William & Grace Dial Center for Speech and Communication Studies
- **visual_arts_design**: Architecture, Art + Art History, Fine Arts, Interior
  Design, Landscape Architecture
- **performing_arts_music**: Music, Theatre + Dance
- **writing_literature**: English, Writing Program (University)
- **languages_global**: Languages Literatures and Cultures, African | Languages
  Literatures and Cultures, Arabic, Chinese, Czech, French, German, Haitian
  Creole, Hebrew, Hindi-Urdu, Italian, Japanese, Korean, Polish, Portuguese,
  Russian, Spanish, Spanish and Portuguese Studies, Turkish, Vietnamese,
  Hungarian, Linguistics, European Studies, African Studies, Latin American
  Studies
- **history_culture_philosophy**: History, Philosophy, Religion, Classics,
  Greek Studies, Latin, Medieval and Early Modern Studies, Jewish Studies,
  Hamilton School
- **politics_law**: Political Science, Hamilton School
- **society_social_sciences**: Sociology, Anthropology, Criminology, Geography,
  Gender Sexualities and Women's Studies, African American Studies
- **psychology_behavior**: Psychology, Clinical and Health Psychology, Family
  Youth and Community Sciences
- **education_teaching**: Education (all three schools)

**Not mapped (not topics a student "likes"):** Career Development Program,
Honors Program, Quest, Interdisciplinary Studies (program labels), and
Military Science (undecided).

## Changes from v0

- `construction_planning` moved from Society & Humanities to Technology &
  Engineering (fits better, and evens out the groups: 4 and 6 instead of 3 and 7).
  Its ID is unchanged, so no data changes.
- Added a list version (`interests_v1`) and a rule that IDs are never renamed
  or reused.
- Added "How courses get tagged": subject map gives default tags, description
  review overrides them, and each tag records its source and version.
