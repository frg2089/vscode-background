import fs from 'fs/promises';
import path from 'path';
import sudo from 'sudo-prompt';

import vscode from 'vscode';

import { vsHelp } from './vsHelp';
import { vscodePath } from './vscodePath';
import { getCss } from './getCss';
import { defBase64 } from './defBase64';
import { version, BACKGROUND_VER, ENCODE } from './constants';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

/**
 * css文件修改状态类型
 *
 * @enum {number}
 */
enum ECSSEditType {
    /**
     * 未修改的css文件
     */
    noModified,
    /**
     * hack 过的旧版本css文件
     */
    isOld,
    /**
     * hack 过的新版本的css文件
     */
    isNew
}

/**
 * 插件逻辑类
 *
 * @export
 * @class Background
 */
class Background {
    //#region private fields 私有字段

    /**
     * 当前用户配置
     *
     * @private
     * @type {vscode.WorkspaceConfiguration}
     * @memberof Background
     */
    private config: vscode.WorkspaceConfiguration = vscode.workspace.getConfiguration('background');

    //#endregion

    //#region public fields public字段

    /**
     * 是否已经安装过
     *
     * @readonly
     * @type {boolean}
     * @memberof Background
     */
    public async hasInstalled(): Promise<boolean> {
        const content = await this.getCssContent();
        if (!content) {
            return false;
        }

        return !!~content.indexOf(BACKGROUND_VER);
    }

    /**
     * 当前css文件的修改类型
     *
     * @readonly
     * @type {ECSSEditType}
     * @memberof Background
     */
    public async fileType(): Promise<ECSSEditType> {
        if (!(await this.hasInstalled())) {
            return ECSSEditType.noModified;
        }

        const cssContent = await this.getCssContent();

        // hack 过的旧版本，即不包含当前版本
        const ifVerOld = !~cssContent.indexOf(`/*${BACKGROUND_VER}.${version}*/`);

        if (ifVerOld) {
            return ECSSEditType.isOld;
        }

        // hack 过的新版本
        return ECSSEditType.isNew;
    }

    //#endregion

    //#region private methods 私有方法

    /**
     * 获取 css 文件内容
     *
     * @private
     * @returns {string}
     * @memberof Background
     */
    private async getCssContent(): Promise<string> {
        return await fs.readFile(vscodePath.cssPath, ENCODE);
    }

    /**
     * 设置 css 文件内容
     *
     * @private
     * @param {string} content
     * @memberof Background
     */
    private async saveCssContent(content: string): Promise<boolean> {
        if (!content || !content.length) {
            return false;
        }
        try {
            await fs.writeFile(vscodePath.cssPath, content, ENCODE);
            return true;
        } catch (e) {
            const retry = 'Retry with Admin';
            const result = await vscode.window.showErrorMessage(e.message, retry);
            if (result !== retry) {
                return false;
            }
            const tempFilePath = await this.saveCssContentToTemp(content);
            try {
                const mvcmd = process.platform === 'win32' ? 'move /Y' : 'mv -f';
                const cmdarg = `${mvcmd} "${tempFilePath}" "${vscodePath.cssPath}"`;
                await this.sudoCommand(cmdarg, { name: 'Visual Studio Code Background Extension' });
                return true;
            } catch (e) {
                await vscode.window.showErrorMessage(e.message);
                return false;
            } finally {
                await fs.rm(tempFilePath);
            }
        }
    }

    /**
     * 提权运行命令
     * @param cmd 命令
     * @param options 选项
     * @returns 命令输出
     */
    private async sudoCommand(
        cmd: string,
        options?: { name?: string; icns?: string; env?: { [key: string]: string } }
    ): Promise<[stdout?: string | Buffer, stderr?: string | Buffer]> {
        return new Promise((resolve, reject) => {
            const callback = (error: Error, stdout: string | Buffer, stderr: string | Buffer) => {
                if (error) {
                    reject(error);
                }
                resolve([stdout, stderr]);
            };
            if (!options) {
                sudo.exec(cmd, callback);
                return;
            }
            sudo.exec(cmd, options, callback);
        });
    }

    /**
     * 保存CSS到临时文件
     * @param content CSS文件内容
     * @returns 临时文件路径
     */
    private async saveCssContentToTemp(content: string): Promise<string> {
        const tempPath = path.resolve(tmpdir(), `vscode-background-${randomUUID()}.css`);
        await fs.writeFile(tempPath, content, ENCODE);
        return tempPath;
    }

    /**
     * 初始化
     *
     * @private
     * @memberof Background
     */
    private async initialize(): Promise<void> {
        const firstload = await this.checkFirstload(); // 是否初次加载插件

        const fileType = await this.fileType(); // css 文件目前状态

        // 如果是第一次加载插件，或者旧版本
        if (firstload || fileType == ECSSEditType.isOld || fileType == ECSSEditType.noModified) {
            await this.install(true);
        }
    }

    /**
     * 检测是否初次加载，并在初次加载的时候提示用户
     *
     * @private
     * @returns {boolean} 是否初次加载
     * @memberof Background
     */
    private async checkFirstload(): Promise<boolean> {
        const configPath = path.join(__dirname, '../assets/config.json');
        const info: { firstload: boolean } = JSON.parse(await fs.readFile(configPath, ENCODE));

        if (info.firstload) {
            // 提示
            vsHelp.showInfo('Welcome to use background! U can config it in settings.json.');
            // 标识插件已启动过
            info.firstload = false;
            fs.writeFile(configPath, JSON.stringify(info, null, '    '), ENCODE);

            return true;
        }

        return false;
    }

    /**
     * 安装插件，hack css
     *
     * @private
     * @param {boolean} [refresh] 需要强制更新
     * @returns {void}
     * @memberof Background
     */
    private async install(refresh?: boolean): Promise<void> {
        const lastConfig = this.config; // 之前的配置
        const config = vscode.workspace.getConfiguration('background'); // 当前用户配置

        // 1.如果配置文件改变的时候，当前插件配置没有改变，则返回
        if (!refresh && JSON.stringify(lastConfig) == JSON.stringify(config)) {
            // console.log('配置文件未改变.')
            return;
        }

        // 之后操作有两种：1.初次加载  2.配置文件改变

        // 2.两次配置均为，未启动插件
        if (!lastConfig.enabled && !config.enabled) {
            // console.log('两次配置均为，未启动插件');
            return;
        }

        // 3.保存当前配置
        this.config = config; // 更新配置

        // 4.如果关闭插件
        if (!config.enabled) {
            await this.uninstall();
            await vsHelp.showInfoRestart('Background has been uninstalled! Please restart.');
            return;
        }

        // 5.hack 样式
        let arr = defBase64; // 默认图片

        if (!config.useDefault) {
            // 自定义图片
            arr = config.customImages;
        }

        // 自定义的样式内容
        const content = (
            await getCss(
                arr,
                config.style,
                config.styles,
                config.useFront,
                config.loop,
                config.minimapOpacity,
                config.customBackgroundSelectors,
                config.customRemoveBackgroundSelectors
            )
        ).trimEnd(); // 去除末尾空白

        // 添加到原有样式(尝试删除旧样式)中
        let cssContent = await this.getCssContent();
        cssContent = this.clearCssContent(cssContent);
        cssContent += content;

        if (await this.saveCssContent(cssContent)) {
            await vsHelp.showInfoRestart('Background has been changed! Please restart.');
        }
    }

    /**
     * 清理css中的添加项
     *
     * @private
     * @param {string} content
     * @returns {string}
     * @memberof Background
     */
    private clearCssContent(content: string): string {
        content = content.replace(/\/\*css-background-start\*\/[\s\S]*?\/\*css-background-end\*\//g, '');
        content = content.replace(/\s*$/, '');
        return content;
    }

    //#endregion

    //#region public methods

    /**
     * 卸载
     *
     * @returns {boolean}
     * @memberof Background
     * @returns 是否成功卸载
     */
    public async uninstall(): Promise<boolean> {
        try {
            let content = await this.getCssContent();
            content = this.clearCssContent(content);
            return await this.saveCssContent(content);
        } catch (ex) {
            console.log(ex);
            return false;
        }
    }

    /**
     * 初始化，并开始监听配置文件改变
     *
     * @returns {vscode.Disposable}
     * @memberof Background
     */
    public async watch(): Promise<vscode.Disposable> {
        await this.initialize();
        return vscode.workspace.onDidChangeConfiguration(async () => await this.install());
    }

    //#endregion
}

export const background = new Background();
