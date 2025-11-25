#!/bin/sh
sysctl -n vm.loadavg | awk '{printf "%.1f %.1f %.1f", $2, $3, $4}'
