#!/bin/sh
top -l 2 | grep 'CPU usage' | tail -1 | awk '{print int($3+$5)}'
