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

import { expect } from '@oclif/test';
import { existsSync } from 'fs';
import 'mocha';
import { BootstrapUtils, ConfigLoader, Preset } from '../../src/service';
import { BackupSyncService } from '../../src/service/BackupSyncService';

describe('BackupSyncService', () => {
    it('run', async () => {
        const target = 'target/BackupSyncService.test';
        await BootstrapUtils.deleteFolder(target);
        await BootstrapUtils.mkdir(target);
        const service = new BackupSyncService('.', { target: target });

        const preset = Preset.testnet;
        const presetData = new ConfigLoader().createPresetData({
            root: '.',
            preset: preset,
            assembly: 'dual',
            customPresetObject: {
                backupSyncLocation: 'https://symbol-bootstrap.s3-eu-west-1.amazonaws.com/testnet/testnet-unit-test.zip',
                backupSyncLocalCacheFileName: 'testnet-unit-test.zip',
            },
        });
        await service.run(presetData);
        expect(existsSync(`${target}/nodes/api-node/data/00000/00002.dat`)).eq(true);
        expect(existsSync(`${target}/databases/db/mongod.lock`)).eq(true);
    });
});
