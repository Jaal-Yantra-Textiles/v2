import { requireAuth } from "@/lib/auth-cookie";


export default async function Dashboard() {
  await requireAuth(); // redirects to /login if absent
  return (
    <div>
      Partner dashboard – you’re logged in.
    </div>
  );
}
