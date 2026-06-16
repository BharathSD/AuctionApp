#!/bin/sh
# Run this script in Git Bash (not PowerShell)

git filter-branch -f --env-filter '
if [ "$GIT_AUTHOR_NAME" = "Shivapuram Bharath (uidq1602)" ]; then
    GIT_AUTHOR_NAME="Bharath S D";
    GIT_AUTHOR_EMAIL="shivapuram.bharath@gmail.com";
fi
if [ "$GIT_COMMITTER_NAME" = "Shivapuram Bharath (uidq1602)" ]; then
    GIT_COMMITTER_NAME="Bharath S D";
    GIT_COMMITTER_EMAIL="shivapuram.bharath@gmail.com";
fi
' --tag-name-filter cat -- --branches --tags

git push --force --all
git push --force --tags
