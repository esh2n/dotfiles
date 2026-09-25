#!/bin/sh
ps -caxm -orss= | awk '{sum+=$1} END {print int(sum*100/37748736)}'
