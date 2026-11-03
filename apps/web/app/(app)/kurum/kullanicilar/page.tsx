import { redirect } from "next/navigation";

// DEC-20261102-01 (F-21): the "Kullanıcı hesapları" tab is retired. Accounts, roles and access are managed on
// Çalışanlar; old links land there and keep their search term. The tenant user API stays as a transition contract.
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const search = (await searchParams).usersQ;
  const term = (Array.isArray(search) ? search[0] : search)?.trim();
  redirect(term ? `/kurum/calisanlar?${new URLSearchParams({ employeesQ: term }).toString()}` : "/kurum/calisanlar");
}
