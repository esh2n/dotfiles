{ buildGoModule, fetchFromGitHub }:
buildGoModule rec {
  pname = "spanner-dump";
  version = "6983541";
  src = fetchFromGitHub {
    owner = "cloudspannerecosystem";
    repo = "spanner-dump";
    rev = "6983541f4cffd4f032e4577efdf27222f3a5df99";
    hash = "sha256-dEayfG9XLP3zFzGlNtVga5qtJp6sY1JbFfi5BpG9P/4=";
  };
  vendorHash = "sha256-poMojfYnSn6X4qEa311r24ZUxR+ED8xNKDIwpGV7tDE=";
  doCheck = false;
}
