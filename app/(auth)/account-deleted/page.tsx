import type { Metadata } from "next"
import { AccountDeleted } from "@/components/settings/account-deleted"

export const metadata: Metadata = { title: "Account deleted · GatorAdvisor AI" }

/* Public: deleting an account signs the student out before they land here. */
export default function AccountDeletedPage() {
  return <AccountDeleted />
}
