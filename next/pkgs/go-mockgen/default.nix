{ buildGoModule, fetchFromGitHub }:
buildGoModule rec {
  pname = "mockgen";
  version = "1.6.0";
  src = fetchFromGitHub {
    owner = "golang";
    repo = "mock";
    rev = "v${version}";
    hash = "sha256-5Kp7oTmd8kqUN+rzm9cLqp9nb3jZdQyltGGQDiRSWcE=";
  };
  vendorHash = "sha256-5gkrn+OxbNN8J1lbgbxM8jACtKA7t07sbfJ7gVJWpJM=";
  subPackages = [ "mockgen" ];
  doCheck = false;
}
