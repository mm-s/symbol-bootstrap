/*
 * Copyright 2021 NEM
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { existsSync } from 'fs';
import * as StreamZip from 'node-stream-zip';
import { join } from 'path';
import { LogType } from '../logger';
import Logger from '../logger/Logger';
import LoggerFactory from '../logger/LoggerFactory';
import { ConfigPreset } from '../model';
import { BootstrapUtils } from './BootstrapUtils';

type BackupSyncParams = {
    readonly target: string;
};

const logger: Logger = LoggerFactory.getLogger(LogType.System);

export class BackupSyncService {
    constructor(private readonly root: string, protected readonly params: BackupSyncParams) {}

    public async run(presetData: ConfigPreset): Promise<void> {
        if (!presetData.backupSyncLocation) {
            throw new Error(`Backup Sync cannot be executed. backupSyncLocation has not been defined.`);
        }
        await BootstrapUtils.mkdir(join(this.root, 'backup-sync'));
        const globalDestination = join(
            this.root,
            'backup-sync',
            presetData.backupSyncLocalCacheFileName || `backup-${presetData.nemesisGenerationHashSeed}.zip`,
        );
        await BootstrapUtils.download(presetData.backupSyncLocation, globalDestination);

        await Promise.all(
            (presetData.databases || []).map(async (db) => {
                const destinationFolder = BootstrapUtils.getTargetDatabasesFolder(this.params.target, false, db.name);
                if (existsSync(destinationFolder)) {
                    logger.info(`${destinationFolder} exist. Backup Sync ignored.`);
                    return;
                }
                await BootstrapUtils.deleteFolder(destinationFolder);
                await BootstrapUtils.mkdir(destinationFolder);
                await this.unzip(globalDestination, 'mongo', destinationFolder);
            }),
        );
        await Promise.all(
            (presetData.nodes || []).map(async (node) => {
                const destinationFolder = BootstrapUtils.getTargetNodesFolder(this.params.target, false, node.name, 'data');
                if (existsSync(destinationFolder)) {
                    logger.info(`${destinationFolder} exist. Backup Sync ignored.`);
                    return;
                }
                await BootstrapUtils.deleteFolder(destinationFolder);
                await BootstrapUtils.mkdir(destinationFolder);
                await this.unzip(globalDestination, 'data', destinationFolder);
            }),
        );
    }

    private unzip(globalDestination: string, innerFolder: string, targetFolder: string): Promise<void> {
        const zip = new StreamZip({
            file: globalDestination,
            storeEntries: true,
        });
        logger.info(`Unziping Backup Sync's ${innerFolder} into ${targetFolder}`);
        return new Promise<void>((resolve, reject) => {
            zip.on('ready', () => {
                zip.extract(innerFolder, targetFolder, (err) => {
                    zip.close();
                    logger.info(`Unzipped ${targetFolder} created`);
                    if (err) {
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });
    }
}
