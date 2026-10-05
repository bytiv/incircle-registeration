import { redirect } from "next/navigation";

/**
 * /register — the address the registration page had before the site moved to the root. Old
 * links land on the form itself.
 */
export default function RegisterPage() {
  redirect("/#register");
}
