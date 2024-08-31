#!/bin/bash

# File name
CHANGELOG_FILE="CHANGELOG.md"

# Get current date
CURRENT_DATE=$(date +"%Y-%m-%d")

# Prompt for version
read -p "Enter version number: " VERSION

# Prompt for description
read -p "Enter change description: " DESCRIPTION

# Create or append to CHANGELOG.md
if [ ! -f "$CHANGELOG_FILE" ]; then
    echo "# Changelog" > "$CHANGELOG_FILE"
    echo "" >> "$CHANGELOG_FILE"
fi

# Add new entry
{
    echo "## [$VERSION] - $CURRENT_DATE"
    echo ""
    echo "- $DESCRIPTION"
    echo ""
} >> "$CHANGELOG_FILE"

echo "Changelog updated successfully!"