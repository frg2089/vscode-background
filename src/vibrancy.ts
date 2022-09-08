import vscode from 'vscode';
import { EXTENSION_ID } from './constants';
import { background } from './background';
import path from 'path';
import { vsHelp } from './vsHelp';

const vibrancyIds = ['illixion.vscode-vibrancy-continued', 'eyhn.vscode-vibrancy'];
const vibrancyConfig = 'vscode_vibrancy';
const vibrancyConfigImports = 'imports';

const fileName = `${EXTENSION_ID}-love-vibrancy.css`;
export const cssPath = path.resolve(path.join(__dirname, `../${fileName}`));

export const check = (): vscode.Extension<any> | undefined => {
    for (const id of vibrancyIds) {
        const ext = vscode.extensions.getExtension(id);
        if (ext) {
            return ext;
        }
    }
    return undefined;
};

export const update = async (content: string): Promise<void> => {
    // 先写文件
    const task = background.saveCssContent(content, cssPath);

    // 读 Vibrancy 配置
    const conf = vscode.workspace.getConfiguration(vibrancyConfig);
    const imports = conf.get<Array<string>>(vibrancyConfigImports);

    // 判断是写入新路径还是更新原有路径
    const index = imports.findIndex(s => s.endsWith(fileName));
    if (index < 0) {
        imports.push(cssPath);
        imports.reverse();
    } else {
        imports[index] = cssPath;
    }

    if (await task) {
        // 更新配置
        await conf.update(vibrancyConfigImports, imports, true);
        await vsHelp.showInfoRestart('Background has been changed! Please restart.');
    }
};
