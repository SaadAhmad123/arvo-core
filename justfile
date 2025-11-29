# Docker-Isolated NPM Development Environment
#
# This justfile provides Docker-based sandbox isolation for npm operations to protect against
# supply chain attacks during local development on local machine. All npm operations 
# run in ephemeral containers with no access to your host filesystem, environment 
# variables, or secrets.
#
# WHAT THIS PROTECTS AGAINST:
# - Malicious install scripts stealing SSH keys, AWS credentials, or other secrets
# - Package typosquatting attacks that exfiltrate local environment variables
# - Compromised packages accessing your home directory during installation
# - Supply chain attacks that attempt to modify files outside node_modules
# - Malicious code execution during build and test phases (runs in isolated containers)
#
# WHAT THIS DOESN'T PROTECT AGAINST:
# - Malicious code in package runtime logic when you actually run your application
# - Sophisticated obfuscated malware that bypasses basic pattern detection
# - Attacks that only activate in production environments
# 
# **Disclaimer:** This does not gate against malware in node_modules or in your code 
# (you need to update the Docker.install to add that gate as per your requirments 
# - if you need one). Rather, its scope is **strictly limited** to attempting to protect
# the host device from exposure if the malware gets excuted.
#
# HOW IT WORKS:
# INSTALL PHASE:
#   1. npm install runs inside a clean Docker container with no volume mounts
#   2. Basic placeholder malware detection (so the you can add more complex methods if you want) scans run after installation completes
#   3. Only node_modules and package files are extracted back to your host
#   4. Container is destroyed, leaving no trace of potentially malicious install scripts
#
# BUILD PHASE:
#   1. Source code and dependencies are copied into a fresh container
#   2. Build process (TypeScript compilation, bundling, etc.) runs isolated
#   3. Only the compiled output (dist/) is extracted back to host
#   4. Any malicious code that tries to run during build is contained
#
# TEST PHASE:
#   1. Tests run in an isolated container with optional .env file mounting
#   2. Test dependencies can't access your host system during execution
#   3. Container is destroyed after tests complete
#   4. Secrets in .env are passed at runtime, never baked into image layers
#
# USAGE:
#   just install                    # Install all dependencies from package.json
#   just install <package>          # Install specific package(s)
#   just install-dev <package>      # Install as dev dependency
#   just test                       # Run tests in isolated container
#   just build                      # Build project in isolated container
#   just clean                      # Remove node_modules

node_version := `cat .nvmrc | tr -d 'v\n\r'`

install *PACKAGES:
    #!/usr/bin/env bash
    set -euo pipefail
    NODE_VERSION={{node_version}}
    echo "Installing dependencies with Node $NODE_VERSION..."
    docker build --progress=plain -f Dockerfile.install --build-arg NODE_VERSION=$NODE_VERSION --build-arg PACKAGES="{{PACKAGES}}" -t npm-installer .
    CONTAINER_ID=$(docker create --name npm-temp npm-installer)
    docker logs $CONTAINER_ID
    echo "Extracting node_modules..."
    docker cp npm-temp:/install/node_modules ./node_modules
    docker cp npm-temp:/install/package.json ./package.json
    docker cp npm-temp:/install/package-lock.json ./package-lock.json 2>/dev/null || true
    echo "Cleaning up..."
    docker rm npm-temp
    docker rmi npm-installer
    echo "Done."

install-dev *PACKAGES:
    #!/usr/bin/env bash
    set -euo pipefail
    NODE_VERSION={{node_version}}
    echo "Installing dev dependencies with Node $NODE_VERSION..."
    docker build --progress=plain -f Dockerfile.install --build-arg NODE_VERSION=$NODE_VERSION --build-arg PACKAGES="{{PACKAGES}}" --build-arg DEV=true -t npm-installer .
    CONTAINER_ID=$(docker create --name npm-temp npm-installer)
    docker logs $CONTAINER_ID
    echo "Extracting node_modules..."
    docker cp npm-temp:/install/node_modules ./node_modules
    docker cp npm-temp:/install/package.json ./package.json
    docker cp npm-temp:/install/package-lock.json ./package-lock.json 2>/dev/null || true
    echo "Cleaning up..."
    docker rm npm-temp
    docker rmi npm-installer
    echo "Done."

build:
    #!/usr/bin/env bash
    set -euo pipefail
    NODE_VERSION=$(cat .nvmrc | tr -d 'v\n\r')
    echo "Building with Node $NODE_VERSION..."
    # Build does not need network. So it must not use it
    docker build --network none --progress=plain -f Dockerfile --build-arg NODE_VERSION=$NODE_VERSION -t npm-build .
    CONTAINER_ID=$(docker create npm-build)
    echo "Extracting build artifacts..."
    docker cp $CONTAINER_ID:/app/dist ./dist
    echo "Cleaning up..."
    docker rm $CONTAINER_ID
    docker rmi npm-build
    echo "Build complete. Output in ./dist"

test:
    #!/usr/bin/env bash
    set -euo pipefail
    NODE_VERSION=$(cat .nvmrc | tr -d 'v\n\r')
    echo "Running tests with Node $NODE_VERSION..."
    docker build --progress=plain -f Dockerfile.test --build-arg NODE_VERSION=$NODE_VERSION -t npm-test .

    # Run tests with .env file mounted if it exists
    if [ -f .env ]; then
        echo "Found .env file, mounting it..."
        docker run --rm --env-file .env npm-test
    else
        echo "No .env file found, running without environment variables..."
        ## If the .env is not there then I can safely assume the there is
        ## no need so making netowrk calls
        docker run --rm --network none npm-test
    fi
    echo "Tests complete."

clean:
    rm -rf node_modules