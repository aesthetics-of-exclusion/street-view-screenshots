#!/usr/bin/env bash

while read -r feature
do
  ./index.js -f "$feature";
done
