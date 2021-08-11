import * as constants from '../constants';
import { cloneAndGenerateBasePaths, generateBasePaths, getPackageString, resolveAbsolutePath, validateAndReturnReadmePath } from '../specs';
import { SchemaConfiguration, generateSchemas, clearAutoGeneratedSchemaRefs, saveAutoGeneratedSchemaRefs, getApiVersionsByNamespace } from '../generate';
import { findOrGenerateAutogenEntries } from '../autogenlist';
import chalk from 'chalk';
import { flatten, keys, partition } from 'lodash';
import { executeSynchronous, chunker, writeJsonFile, lowerCaseEquals } from '../utils';
import { AutoGenConfig, Package } from '../models';

interface GenerateAllParams {
    batchCount?: number,
    batchIndex?: number,
    localPath?: string,
    readmeFiles?: string[],
    outputPath?: string,
}

function parseParams(): GenerateAllParams {
    if (!process.argv[2]) {
        return {};
    }

    return JSON.parse(process.argv[2]);
}

executeSynchronous(async () => {
    const params = parseParams();

    let basePaths;
    let localPath = params.localPath;
    if (!localPath) {
        localPath = constants.specsRepoPath;
        basePaths = await cloneAndGenerateBasePaths(localPath, constants.specsRepoUri, constants.specsRepoCommitHash);
    } else {
        localPath = await resolveAbsolutePath(localPath);
        basePaths = await generateBasePaths(localPath);
    }

    if (params.batchCount !== undefined && params.batchIndex !== undefined) {
        basePaths = chunker(basePaths, params.batchCount)[params.batchIndex];
    }

    const schemaConfigs: SchemaConfiguration[] = [];
    const errors = [];
    const packages: Package[] = [];

    for (const basePath of basePaths) {
        const readme = await validateAndReturnReadmePath(localPath, basePath);
        const namespaces = keys(await getApiVersionsByNamespace(readme));
        let filteredAutoGenList = findOrGenerateAutogenEntries(basePath, namespaces);

        if (!!params.readmeFiles) {
            filteredAutoGenList = filteredAutoGenList.filter(c => {
                let r = params.readmeFiles?.find(f => f.startsWith('specification/' + c.basePath));
                if (!!r) {
                    c.readmeFile = r;
                    return true;
                }
                return false;
            });
        }

        await clearAutoGeneratedSchemaRefs(filteredAutoGenList);

        for (const autoGenConfig of filteredAutoGenList) {
            if (autoGenConfig.disabledForAutogen === true) {
                continue;
            }

            let pkg = {
                path: ['schemas']
            } as Package;
            try {
                const readme = await validateAndReturnReadmePath(localPath, autoGenConfig.readmeFile || autoGenConfig.basePath);
                pkg.packageName = getPackageString(readme);

                const newConfigs = await generateSchemas(readme, autoGenConfig);
                schemaConfigs.push(...newConfigs);
                pkg.result = 'succeeded';
            } catch(error) {
                pkg.packageName = autoGenConfig.basePath;
                pkg.result = 'failed';
                console.log(chalk.red(`Caught exception processing autogenlist entry ${autoGenConfig.basePath}.`));
                console.log(chalk.red(error));
        
                errors.push(error);
            }
            packages.push(pkg);
        }
    }

    await saveAutoGeneratedSchemaRefs(flatten(schemaConfigs));

    if (!!params.outputPath) {
        const outputPath = await resolveAbsolutePath(params.outputPath);
        await writeJsonFile(outputPath, { packages });
    } else {
        if (errors.length > 0) {
            throw new Error(`Autogeneration failed with ${errors.length} errors. See logs for detailed information.`);
        }
    }

});
