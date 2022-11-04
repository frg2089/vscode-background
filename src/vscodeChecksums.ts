import { vscodePath } from './vscodePath';
import crypto from 'crypto';
import { readFile } from 'fs/promises';
import fs from 'fs/promises';
import vscode from 'vscode';

/**
 * 计算的校验值
 */
export const computeChecksum = async (filePath: string) => {
    const content = await readFile(filePath);
    return crypto.createHash('md5').update(content).digest('base64').replace(/=+$/, '');
};

/**
 * 若校验值不同则返回新的product.json内容
 */
export const getNewProduct = (newChecksum: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const product = require(vscodePath.productPath);

    // 获取Key
    const key = vscodePath.cssPath.replace(`${vscodePath.base}`, '').replace(/\\/g, '/').substring(1);

    if (product.checksums[key] !== newChecksum) {
        product.checksums[key] = newChecksum;
        return JSON.stringify(product, null, '\t');
    }
};

export const changeProduct = async (
    saveFileToTemp: { (content: string): Promise<string>; (arg0: string, arg1: string): any },
    sudoCommand: {
        (cmd: string, options?: { name?: string }): Promise<any>;
        (arg0: string, arg1: { name: string }): any;
    }
) => {
    const json = getNewProduct(await computeChecksum(vscodePath.cssPath));
    if (json) {
        try {
            await fs.writeFile(vscodePath.productPath, json, { encoding: 'utf8' });
        } catch (e) {
            const retry = 'Retry with Admin/Sudo';
            const result = await vscode.window.showErrorMessage(e.message, retry);
            if (result !== retry) {
                return false;
            }
            const file: Array<{ source: string; target: string }> = [];
            const tempProductFilePath = await saveFileToTemp(json, '.json');
            file.push({ source: tempProductFilePath, target: vscodePath.productPath });

            try {
                const mvcmd = process.platform === 'win32' ? 'move /Y' : 'mv -f';
                const args = file.map(i => `${mvcmd} "${i.source}" "${i.target}"`);
                await sudoCommand(args.join(' && '), { name: 'Visual Studio Code Background Extension' });
                return true;
            } catch (e) {
                await vscode.window.showErrorMessage(e.message);
                return false;
            }
        }
    }
};
