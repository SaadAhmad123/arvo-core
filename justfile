install *PACKAGES:
    #!/usr/bin/env bash
    set -euo pipefail
    NODE_VERSION=$(cat .nvmrc | tr -d 'v\n\r')
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
    NODE_VERSION=$(cat .nvmrc | tr -d 'v\n\r')
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

clean:
    rm -rf node_modules