{ buildGoModule, fetchFromGitHub }:
buildGoModule rec {
  pname = "spanner-cli";
  version = "0d0904f";
  src = fetchFromGitHub {
    owner = "cloudspannerecosystem";
    repo = "spanner-cli";
    rev = "0d0904f873b0712f3114ff62728281b7dc0e9092";
    hash = "sha256-pccPbxKbqQnQDsIhFXUBhX0NPyjWsUCez4gvbdmoB3U=";
  };
  vendorHash = "sha256-BHULxJgFQZd3RmRJNTBGIXhJb6b/aGQSAdIDUiAb5Bo=";
  doCheck = false;
}
