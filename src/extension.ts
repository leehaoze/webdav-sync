// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as path from 'path';

import { createClient, WebDAVClient } from 'webdav';

let outputChannel: vscode.OutputChannel;
let statusBarItem: vscode.StatusBarItem;

// 路径配置
interface PathConfig {
	localBasePath: string;
	remoteBasePath: string;
}

interface PathMapper {
	config: PathConfig;
	
	// 根据本地路径获取远程路径
	getRemotePath(localPath: string): string;
}

const pathConfig: PathConfig = {
	localBasePath: '',
	remoteBasePath: ''
};

const pathMapper: PathMapper = {
	config: pathConfig,

	getRemotePath(localPath: string): string {
		// 统一使用正斜杠
		const normalizedLocalPath = localPath.replace(/\\/g, '/');
		const normalizedBasePath = this.config.localBasePath.replace(/\\/g, '/');

		// 去除本地基础路径
		let relativePath = normalizedLocalPath.replace(normalizedBasePath, '');
		
		// 移除开头的斜杠和可能存在的盘符（比如 C:）
		relativePath = relativePath.replace(/^[\/\\]/, '').replace(/^[A-Za-z]:/, '');
		
		// 确保远程基础路径不以斜杠结尾
		const remoteBase = this.config.remoteBasePath.replace(/\/$/, '');
		
		// 组合远程路径
		return `${remoteBase}/${relativePath}`;
	}
};

// 修改全局变量声明
let isSyncPaused: boolean;
let client: WebDAVClient | null = null;

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
async function activate(context: vscode.ExtensionContext) {
	// 从 workspace state 中恢复同步状态，默认为 true (暂停状态)
	isSyncPaused = context.workspaceState.get('webdav-sync.isSyncPaused', true);
	
	// 创建状态栏项
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	context.subscriptions.push(statusBarItem);
	updateStatusBarItem();

	// 开启log窗口
	context.subscriptions.push(
        outputChannel = vscode.window.createOutputChannel('webdav-sync')
    );
    outputChannel.hide();
	
	// 连接 WebDAV 服务器
	client = await connectWebDAV();

	// 初始化路径配置
	const config = initPathConfig();
	if (!config) {
		vscode.window.showErrorMessage('请在设置中配置 webdav-sync.localPath 和 webdav-sync.remotePath');
		return;
	}

	pathConfig.localBasePath = config.localBasePath;
	pathConfig.remoteBasePath = config.remoteBasePath;

	// 监听配置变更
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('webdav-sync.localPath') || 
				e.affectsConfiguration('webdav-sync.remotePath') ||
				e.affectsConfiguration('webdav-sync.serverHost') ||
				e.affectsConfiguration('webdav-sync.username') ||
				e.affectsConfiguration('webdav-sync.password')) {
				
				outputChannel.appendLine('检测到配置变更，重新初始化...');
				
				// 重新连接WebDAV
				if (e.affectsConfiguration('webdav-sync.serverHost') ||
					e.affectsConfiguration('webdav-sync.username') ||
					e.affectsConfiguration('webdav-sync.password')) {
					client = await connectWebDAV();
				}
				
				// 重新初始化路径配置
				if (e.affectsConfiguration('webdav-sync.localPath') ||
					e.affectsConfiguration('webdav-sync.remotePath')) {
					const newConfig = initPathConfig();
					if (newConfig) {
						pathConfig.localBasePath = newConfig.localBasePath;
						pathConfig.remoteBasePath = newConfig.remoteBasePath;
						outputChannel.appendLine(`路径配置已更新：
本地路径: ${pathConfig.localBasePath}
远程路径: ${pathConfig.remoteBasePath}`);
					}
				}
				
				// 更新状态栏
				updateStatusBarItem();
				
				// 如果有文件监听器，需要重新创建
				if (fileWatcher) {
					fileWatcher.dispose();
					if (client) {
						fileWatcher = watchFile(client, pathConfig);
					}
				}
			}
		})
	);

	// 开启文件监听（只有在连接成功时才监听）
	let fileWatcher: vscode.FileSystemWatcher | undefined;
	if (client) {
		fileWatcher = watchFile(client, pathConfig);
	}

	// 注册重新连接命令
	const reconnectCommand = vscode.commands.registerCommand('webdav-sync.reconnect', async () => {
		client = await connectWebDAV();
		if (client) {
			// 如果之前有文件监听器，先移除
			if (fileWatcher) {
				fileWatcher.dispose();
			}
			// 创建新的文件监听器
			fileWatcher = watchFile(client, pathConfig);
			vscode.window.showInformationMessage('WebDAV 连接已重新建立');
			updateStatusBarItem();
		}
	});

	// 注册右键菜单命令
	const syncCommand = vscode.commands.registerCommand('webdav-sync.syncFile', async (uri: vscode.Uri) => {
		if (!client) {
			vscode.window.showErrorMessage('WebDAV 未连接，请检查配置并重新连接');
			return;
		}

		const webdavClient = client; // 创建一个确定非空的引用

		if (uri) {
			const stat = await vscode.workspace.fs.stat(uri);
			if (stat.type === vscode.FileType.Directory) {
				// 如果是目录，显示进度
				await vscode.window.withProgress({
					location: vscode.ProgressLocation.Notification,
					title: "正在同步文件夹",
					cancellable: true
				}, async (progress, token) => {
					// 获取目录下所有文件
					const files: vscode.Uri[] = [];
					async function collectFiles(folderUri: vscode.Uri) {
						const entries = await vscode.workspace.fs.readDirectory(folderUri);
						for (const [name, type] of entries) {
							const filePath = vscode.Uri.joinPath(folderUri, name);
							if (type === vscode.FileType.Directory) {
								await collectFiles(filePath);
							} else {
								files.push(filePath);
							}
						}
					}
					await collectFiles(uri);

					const totalFiles = files.length;
					let processedFiles = 0;

					// 同步所有文件
					for (const file of files) {
						if (token.isCancellationRequested) {
							outputChannel.appendLine('同步操作已取消');
							break;
						}

						if (!client) {
							outputChannel.appendLine('WebDAV 连接已断开，同步操作终止');
							break;
						}

						try {
							await syncToWebDAV(webdavClient, pathConfig, file, 'modify', false);
							processedFiles++;
							progress.report({
								message: `已同步 ${processedFiles}/${totalFiles} 个文件`,
								increment: (100 / totalFiles)
							});
						} catch (error) {
							outputChannel.appendLine(`同步文件失败 ${file.fsPath}: ${error}`);
							continue;
						}
					}

					outputChannel.appendLine(`文件夹同步完成，共处理 ${processedFiles}/${totalFiles} 个文件`);
					vscode.window.showInformationMessage(`文件夹同步完成: ${uri.fsPath}，共处理 ${processedFiles}/${totalFiles} 个文件`);
				});
			} else {
				// 如果是文件直接同步
				await syncToWebDAV(webdavClient, pathConfig, uri);
			}
		} else {
			vscode.window.showWarningMessage('请在文件或文件夹上右键选择同步');
		}
	});

	// 注册同步所有文件的命令
	const syncAllCommand = vscode.commands.registerCommand('webdav-sync.syncAll', async () => {
		if (!client) {
			vscode.window.showErrorMessage('WebDAV 未连接，请检查配置并重新连接');
			return;
		}

		const webdavClient = client; // 创建一个确定非空的引用

		try {
			// 获取工作区
			const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
			if (!workspaceFolder) {
				vscode.window.showErrorMessage('请打开一个工作区文件夹');
				return;
			}

			// 显示进度
			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "正在同步所有文件",
				cancellable: true
			}, async (progress, token) => {
				// 获取所有文件
				const files = await getAllFiles(workspaceFolder.uri);
				const totalFiles = files.length;
				let processedFiles = 0;

				outputChannel.appendLine(`开始同步所有文件，共 ${totalFiles} 个文件`);

				// 同步每个文件
				for (const file of files) {
					if (token.isCancellationRequested) {
						outputChannel.appendLine('同步操作已取消');
						break;
					}

					try {
						await syncToWebDAV(webdavClient, pathConfig, file, 'modify', false);
						processedFiles++;
						progress.report({
							message: `已同步 ${processedFiles}/${totalFiles} 个文件`,
							increment: (100 / totalFiles)
						});
					} catch (error) {
						outputChannel.appendLine(`同步文件失败 ${file.fsPath}: ${error}`);
						// 继续同步其他文件
						continue;
					}
				}

				outputChannel.appendLine(`同步完成，共处理 ${processedFiles}/${totalFiles} 个文件`);
				vscode.window.showInformationMessage(`同步完成，共处理 ${processedFiles}/${totalFiles} 个文件`);
			});
		} catch (error) {
			outputChannel.appendLine(`同步所有文件失败: ${error}`);
			vscode.window.showErrorMessage(`同步所有文件失败: ${error instanceof Error ? error.message : String(error)}`);
		}
	});

	// 修改暂停同步命令
	const pauseSyncCommand = vscode.commands.registerCommand('webdav-sync.pauseSync', async () => {
		isSyncPaused = true;
		await context.workspaceState.update('webdav-sync.isSyncPaused', true);
		updateStatusBarItem();
		outputChannel.appendLine('WebDAV 同步已暂停');
		vscode.window.showInformationMessage('WebDAV 同步已暂停');
	});

	// 修改恢复同步命令
	const resumeSyncCommand = vscode.commands.registerCommand('webdav-sync.resumeSync', async () => {
		if (!client) {
			vscode.window.showErrorMessage('WebDAV 未连接，请检查配置并重新连接');
			return;
		}

		isSyncPaused = false;
		await context.workspaceState.update('webdav-sync.isSyncPaused', false);
		updateStatusBarItem();
		outputChannel.appendLine('WebDAV 同步已恢复');
		vscode.window.showInformationMessage('WebDAV 同步已恢复');
	});

	// 将新命令添加到订阅列表
	context.subscriptions.push(
		reconnectCommand,
		...(fileWatcher ? [fileWatcher] : []),
		syncCommand,
		syncAllCommand,
		pauseSyncCommand,
		resumeSyncCommand
	);

	// 在初始化完成后根据状态显示对应提示
	if (!client) {
		vscode.window.showErrorMessage('WebDAV 连接失败，请检查配置并使用命令面板中的"Reconnect WebDAV"重新连接');
	} else {
		outputChannel.appendLine(`WebDAV 同步已启动，当前处于${isSyncPaused ? '暂停' : '运行'}状态`);
		vscode.window.showInformationMessage(
			isSyncPaused 
				? 'WebDAV 同步已启动，当前处于暂停状态。使用命令面板中的"Start WebDAV Sync"来开始同步。'
				: 'WebDAV 同步已启动，当前处于运行状态。'
		);
	}
}

// 监听文件变化
function watchFile(webdavClient: WebDAVClient, pathConfig: PathConfig): vscode.FileSystemWatcher {
	const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

	// 文件创建事件
	fileWatcher.onDidCreate(uri => {
		if (isHiddenFile(pathConfig, uri) || isSyncPaused || !client) {
			return;
		}
		syncToWebDAV(webdavClient, pathConfig, uri, 'create');
	});

	// 文件修改事件
	fileWatcher.onDidChange(uri => {
		if (isHiddenFile(pathConfig, uri) || isSyncPaused || !client) {
			return;
		}
		syncToWebDAV(webdavClient, pathConfig, uri, 'modify');
	});

	// 文件删除事件
	fileWatcher.onDidDelete(uri => {
		if (isHiddenFile(pathConfig, uri) || isSyncPaused || !client) {
			return;
		}
		syncToWebDAV(webdavClient, pathConfig, uri, 'delete');
	});

	return fileWatcher;
}

// 同步文件到 WebDAV 服务器
async function syncToWebDAV(
    webdavClient: WebDAVClient, 
    pathConfig: PathConfig, 
    uri: vscode.Uri, 
    action: 'create' | 'modify' | 'delete' = 'modify',
    showNotification: boolean = true
) {
    try {
        // 获取相对路径
        const relativePath = path.relative(pathConfig.localBasePath, uri.fsPath);
        // 获取远程路径
        const remotePath = pathMapper.getRemotePath(uri.fsPath);

        outputChannel.appendLine(`准备同步文件: ${uri.fsPath}`);
        outputChannel.appendLine(`远程路径: ${remotePath}`);
        outputChannel.appendLine(`动作: ${action}`);

        switch (action) {
            case 'create':
            case 'modify':
                // 确保远程目录存在
                const remoteDir = path.dirname(remotePath);
                await ensureRemoteDirectory(webdavClient, remoteDir);
                
                // 读取文件内容
                const content = await vscode.workspace.fs.readFile(uri);
                
                // 上传文件
                await webdavClient.putFileContents(remotePath, content, { 
                    overwrite: true,
                    onUploadProgress: (progress) => {
                        outputChannel.appendLine(`上传进度: ${progress.loaded}/${progress.total}`);
                    }
                });
                
                if (showNotification) {
                    vscode.window.setStatusBarMessage(`文件已同步: ${relativePath}`, 3000);
                }
                break;

            case 'delete':
                // 删除远程文件
                await webdavClient.deleteFile(remotePath);
                if (showNotification) {
                    vscode.window.setStatusBarMessage(`文件已删除: ${relativePath}`, 3000);
                }
                break;
        }
    } catch (error) {
        outputChannel.appendLine(`同步失败: ${error instanceof Error ? error.message : String(error)}`);
        if (showNotification) {
            vscode.window.showErrorMessage(`同步失败: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

// 确保远程目录存在
async function ensureRemoteDirectory(client: WebDAVClient, dirPath: string) {
	try {
		const exists = await client.exists(dirPath);
		if (!exists) {
			await client.createDirectory(dirPath, { recursive: true });
		}
	} catch (error) {
		outputChannel.appendLine(`创建远程目录失败: ${error}`);
		throw error;
	}
}


// 检查是否为隐藏文件 默认不上传隐藏文件
function isHiddenFile(pathConfig: PathConfig, uri: vscode.Uri): boolean {
	// 获取相对路径
	const relativePath = path.relative(pathConfig.localBasePath, uri.fsPath);

	// 检查是否为隐藏文件或在隐藏文件夹下
	const pathParts = relativePath.split(path.sep);
	for (const part of pathParts) {
		if (part.startsWith('.')) {
			outputChannel.appendLine(`跳过隐藏文件: ${uri.fsPath}`);
			return true;
		}
	}
	return false;
}

// 初始化路径配置
function initPathConfig(): PathConfig | null {
	const config = vscode.workspace.getConfiguration('webdav-sync');
	let localPath = config.get<string>('localPath');
	const baseURL = config.get<string>('remotePath');

	if (!localPath || !baseURL) {
		vscode.window.showErrorMessage('请在设置中配置 webdav-sync.localPath 和 webdav-sync.remotePath');
		return null;
	}

	// 处理工作区变量
	if (localPath === '${workspaceFolder}' || localPath.includes('${workspaceFolder}')) {
		const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
		if (!workspaceFolder) {
			vscode.window.showErrorMessage('未找到工作区文件夹');
			return null;
		}
		localPath = localPath.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
	}

	return {
		localBasePath: localPath,
		remoteBasePath: baseURL
	};
}

// 连接 WebDAV 服务器
async function connectWebDAV(): Promise<WebDAVClient | null> {
	const config = vscode.workspace.getConfiguration('webdav-sync');
	const serverHost = config.get<string>('serverHost');

	// 用户名密码
	const username = config.get<string>('username');
	const password = config.get<string>('password');

	if (!serverHost) {
		vscode.window.showErrorMessage('请在设置中配置 webdav-sync.serverHost');
		return null;	
	}

	const client = createClient(serverHost, {
		username: username || '',
		password: password || ''
	});


	try {
		// 测试连接
		const stat = await client.stat('/');
		return client;
	} catch (error) {
		vscode.window.showErrorMessage(`WebDAV 连接失败: ${error instanceof Error ? error.message : String(error)}`);
		return null;
	}
}

// 递归获取所有文件
async function getAllFiles(folder: vscode.Uri): Promise<vscode.Uri[]> {
	const files: vscode.Uri[] = [];
	
	async function traverse(uri: vscode.Uri) {
		const entries = await vscode.workspace.fs.readDirectory(uri);
		
		for (const [name, type] of entries) {
			const fullPath = vscode.Uri.joinPath(uri, name);
			
			// 跳过隐藏文件和文件夹
			if (isHiddenFile(pathConfig, fullPath)) {
				continue;
			}
			
			if (type === vscode.FileType.Directory) {
				// 递归处理子目录
				await traverse(fullPath);
			} else if (type === vscode.FileType.File) {
				files.push(fullPath);
			}
		}
	}
	
	await traverse(folder);
	return files;
}

async function deactivate() {
}

// 更新状态栏项
function updateStatusBarItem() {
	if (!client) {
		statusBarItem.text = "$(error) WebDAV 未连接";
		statusBarItem.command = 'webdav-sync.reconnect';
		statusBarItem.tooltip = '点击重新连接';
	} else if (isSyncPaused) {
		statusBarItem.text = "$(sync-ignored) WebDAV 同步已暂停";
		statusBarItem.command = 'webdav-sync.resumeSync';
		statusBarItem.tooltip = '点击恢复同步';
	} else {
		statusBarItem.text = "$(sync) WebDAV 同步运行中";
		statusBarItem.command = 'webdav-sync.pauseSync';
		statusBarItem.tooltip = '点击暂停同步';
	}
	statusBarItem.show();
}

export { activate, deactivate };
