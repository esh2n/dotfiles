# llm-ledger-sync as a package: psql comes with it (the Postgres client only
# talks to the DBs; the servers run in docker).
{
  writeShellApplication,
  coreutils,
  postgresql,
  inetutils,
}:
writeShellApplication {
  name = "llm-ledger-sync";
  runtimeInputs = [
    coreutils
    postgresql
    inetutils
  ];
  text = builtins.readFile ./llm-ledger-sync.sh;
}
