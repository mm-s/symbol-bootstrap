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
import * as archiver from 'archiver';
import { EntryDataFunction } from 'archiver';
import { createWriteStream, existsSync } from 'fs';
import * as StreamZip from 'node-stream-zip';
import { join } from 'path';
import { LogType } from '../logger';
import Logger from '../logger/Logger';
import LoggerFactory from '../logger/LoggerFactory';
import { ConfigPreset, DatabasePreset, NodePreset } from '../model';
import { BootstrapUtils, KnownError } from './BootstrapUtils';
import { ConfigLoader } from './ConfigLoader';

export type BackupSyncParams = {
    readonly target: string;
    readonly nodeName?: string;
    readonly destinationFile?: string;
};

const logger: Logger = LoggerFactory.getLogger(LogType.System);

export class BackupSyncService {
    public static defaultParams: BackupSyncParams = {
        target: BootstrapUtils.defaultTargetFolder,
    };
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
                // const seedFolder = presetData.nemesisSeedFolder || join(this.root, 'presets', this.params.preset, 'seed');
                // await BootstrapUtils.generateConfiguration({}, seedFolder, destinationFolder);
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
        logger.info(`Unzipping Backup Sync's ${innerFolder} into ${targetFolder}`);
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

    private zip(destination: string, node: NodePreset, database: DatabasePreset): Promise<void> {
        // create a file to stream archive data to.
        const output = createWriteStream(destination);
        const archive = archiver('zip', {
            zlib: { level: 9 }, // Sets the compression level.
        });
        logger.info(`Creating zip file ${destination}`);
        return new Promise<void>(async (resolve, reject) => {
            // listen for all archive data to be written
            // 'close' event is fired only when a file descriptor is involved
            output.on('close', () => {
                logger.info(
                    `Zip file ${destination} size ${archive.pointer() / 1024} MB has been created. You can now share it for --backupSync.`,
                );
                resolve();
            });

            // This event is fired when the data source is drained no matter what was the data source.
            // It is not part of this library but rather from the NodeJS Stream API.
            // @see: https://nodejs.org/api/stream.html#stream_event_end
            output.on('end', () => {
                console.log('Data has been drained');
            });

            // good practice to catch warnings (ie stat failures and other non-blocking errors)
            archive.on('warning', (err: any) => {
                if (err.code === 'ENOENT') {
                    // log warning
                    logger.warn(`There has been an warning creating ZIP file '${destination}' ${err.message || err}`);
                } else {
                    // throw error
                    logger.error(`There has been an error creating ZIP file '${destination}' ${err.message || err}`);
                    reject(err);
                }
            });
            // good practice to catch this error explicitly
            archive.on('error', function (err: any) {
                logger.error(`There has been an error creating ZIP file '${destination}' ${err.message || err}`);
                reject(err);
            });

            // pipe archive data to the file
            archive.pipe(output);

            const filter: EntryDataFunction = (entry) => {
                const ignoreFiles = ['server.lock', 'broker.started', 'broker.lock'];
                if (ignoreFiles.indexOf(entry.name) > -1) {
                    logger.info(`Excluding file '${entry.name}'`);
                    return false;
                }
                const ignoreDirectories = ['spool'];
                const ignoreEntryDirectory = ignoreDirectories.find((d) => entry.name.startsWith(d));
                if (ignoreEntryDirectory) {
                    if (entry.name === ignoreEntryDirectory) logger.info(`Excluding directory '${entry.name}'`);
                    return false;
                }
                return entry;
            };
            const mongoFolder = BootstrapUtils.getTargetDatabasesFolder(this.params.target, false, database.name);
            logger.info(`Adding '${mongoFolder}' to zip file ${destination}`);
            archive.directory(`${mongoFolder}/`, 'mongo', filter);
            const dataFolder = BootstrapUtils.getTargetNodesFolder(this.params.target, false, `${node.name}/`, 'data');
            logger.info(`Adding '${dataFolder}' to zip file ${destination}`);
            archive.directory(dataFolder, 'data', filter);
            await archive.finalize();
        });
    }

    public async createBackup(passedPresetData?: ConfigPreset): Promise<void> {
        const configLoader = new ConfigLoader();
        const presetData = passedPresetData ?? configLoader.loadExistingPresetData(this.params.target, '');

        const node = presetData.nodes?.find((node) => (!this.params.nodeName || node.name == this.params.nodeName) && node.api);
        if (!node && this.params.nodeName) {
            throw new KnownError(`Api/Dual node with name '${this.params.nodeName}' has not been configured in this instance!`);
        }
        if (!node) {
            throw new KnownError(`Api/Dual has not been configured in this instance!`);
        }
        const database = presetData.databases?.find((db) => db.name == node.databaseHost || db.host == node.databaseHost);
        if (!database) {
            throw new KnownError(`Database with name/host '${node.databaseHost}' does not exist!`);
        }
        const destination = this.params.destinationFile || join(this.params.target, 'backup.zip');
        BootstrapUtils.deleteFile(destination);
        await this.zip(destination, node, database);
    }
}
