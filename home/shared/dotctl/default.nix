# dotctl on every machine: the jobs the old shell scripts did, one binary.
{ pkgs, ... }:
{
  home.packages = [ pkgs.dotctl ];
}
