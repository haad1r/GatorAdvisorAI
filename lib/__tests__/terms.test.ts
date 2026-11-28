import { describe, expect, it } from "vitest"
import { shortTerm, termForDate, termsBetween } from "../terms"

describe("termForDate", () => {
  it("maps months to UF terms", () => {
    expect(termForDate("2026-01-12")).toBe("Spring 2026")
    expect(termForDate("2026-04-30")).toBe("Spring 2026")
    expect(termForDate("2026-05-11")).toBe("Summer 2026")
    expect(termForDate("2026-07-31")).toBe("Summer 2026")
    expect(termForDate("2026-08-24")).toBe("Fall 2026")
    expect(termForDate("2026-12-31")).toBe("Fall 2026")
  })
})

describe("termsBetween", () => {
  it("lists fall and spring terms, both ends included", () => {
    expect(termsBetween("Fall 2025", "Spring 2027")).toEqual(["Fall 2025", "Spring 2026", "Fall 2026", "Spring 2027"])
  })

  it("adds a summer only when asked", () => {
    expect(termsBetween("Spring 2026", "Fall 2026", ["Summer 2026"])).toEqual(["Spring 2026", "Summer 2026", "Fall 2026"])
    expect(termsBetween("Spring 2026", "Fall 2026")).toEqual(["Spring 2026", "Fall 2026"])
  })

  it("returns one term when first and last match", () => {
    expect(termsBetween("Fall 2026", "Fall 2026")).toEqual(["Fall 2026"])
  })

  it("returns nothing for unreadable or reversed terms", () => {
    expect(termsBetween("", "Spring 2029")).toEqual([])
    expect(termsBetween("Fall 2025", "someday")).toEqual([])
    expect(termsBetween("Spring 2029", "Fall 2025")).toEqual([])
  })

  it("caps very long ranges", () => {
    expect(termsBetween("Fall 2000", "Spring 2040")).toHaveLength(16)
  })
})

describe("shortTerm", () => {
  it("shortens terms", () => {
    expect(shortTerm("Fall 2025")).toBe("F25")
    expect(shortTerm("Spring 2029")).toBe("S29")
    expect(shortTerm("Summer 2026")).toBe("Su26")
  })

  it("leaves anything else alone", () => {
    expect(shortTerm("TBA")).toBe("TBA")
  })
})
