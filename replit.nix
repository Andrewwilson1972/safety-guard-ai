{pkgs}: {
  deps = [
    pkgs.glib
    pkgs.libGL
    pkgs.xorg.libX11
    pkgs.xorg.libxcb
  ];
}
