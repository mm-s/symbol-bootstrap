#!/bin/bash
set -e
mkdir -p backup-sync/testnet-backup
cp -rf target/testnet-dual/databases/db backup-sync/testnet-backup/mongo
cp -rf target/testnet-dual/nodes/api-node/data backup-sync/testnet-backup/data

cd backup-sync/testnet-backup
zip -r testnet-backup.zip *
cd ../..
