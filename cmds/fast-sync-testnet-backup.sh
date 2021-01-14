#!/bin/bash
set -e
mkdir -p fast-sync/testnet-backup
cp -rf target/testnet-dual/databases/db fast-sync/testnet-backup/mongo
cp -rf target/testnet-dual/nodes/api-node/data fast-sync/testnet-backup/data

cd fast-sync/testnet-backup
zip -r testnet-backup.zip *
cd ../..
