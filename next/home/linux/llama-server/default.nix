# llama-server (Linux, gpu role): llama.cpp's CUDA build, pinned by the
# flake's lock, as a systemd --user service in router mode. Nix-built CUDA
# programs find the NVIDIA libraries through home-manager's genericLinux GPU
# support, which must be given the host driver's exact version (facts.nvidia,
# from the roles file). The first time, `make up` runs its root setup step.
{
  config,
  lib,
  pkgs,
  facts,
  ...
}:
let
  cfg = config.dotfiles.homeLlm;
  nvidia =
    if facts.nvidia == null then
      throw ''the gpu role needs the host's NVIDIA driver in the roles file: "nvidia": {"version": "<nvidia-smi driver version>", "sha256": "<nix store prefetch-file https://download.nvidia.com/XFree86/Linux-x86_64/<version>/NVIDIA-Linux-x86_64-<version>.run>"}''
    else if !facts.nvidia.acceptLicense then
      throw ''the gpu role uses NVIDIA's driver libraries, which require accepting the "License For Customer Use of NVIDIA Software" (https://www.nvidia.com/en-us/drivers/nvidia-license/): add "acceptLicense": true to "nvidia" in the roles file if you accept it''
    else
      facts.nvidia;
in
lib.mkIf cfg.gpu {
  home.packages = [ pkgs.llama-server-cuda ];

  targets.genericLinux.gpu = {
    enable = true;
    nvidia = {
      enable = true;
      inherit (nvidia) version sha256;
    };
  };

  dotfiles.services.llama-server = builtins.seq nvidia {
    enable = true;
    script = "next/home/linux/llama-server/llama-server-up.sh";
    environment = {
      LLAMA_SERVER_BIN = lib.getExe' pkgs.llama-server-cuda "llama-server";
      LLAMA_PORT = "8080";
      LLAMA_MODELS_DIR = "${facts.home}/models";
    };
  };
}
