# The one impure read of the whole configuration: facts about the machine
# the flake is evaluated on (requires --impure). Everything else is pure and
# receives these values through the builders, never by reading the
# environment itself.
let
  user = builtins.getEnv "USER";
in
{
  # "ci" keeps pure evaluation (CI without --impure) working.
  username = if user == "" then "ci" else user;
}
