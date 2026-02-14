import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import log from '../log';

interface HelperFunctions {
    getVersionedUrl: (filename: string) => string;
}

export class VersioningService {
    private static assetHashes = new Map<string, string>();
    private static publicPath: string;

    /**
     * Inicializa o serviço calculando hashes dos arquivos estáticos
     */
    static initialize(publicDirPath: string): void {
        this.publicPath = publicDirPath;
        log.info('🔄 Inicializando Versionamento de Assets...');

        const filesToVersion = ['app.js', 'sw.js', 'style.css'];

        for (const file of filesToVersion) {
            try {
                const filePath = path.join(this.publicPath, file);
                if (fs.existsSync(filePath)) {
                    const fileBuffer = fs.readFileSync(filePath);
                    const hashSum = crypto.createHash('md5');
                    hashSum.update(fileBuffer);
                    const hash = hashSum.digest('hex').slice(0, 8); // 8 chars são suficientes
                    this.assetHashes.set(file, hash);
                    log.info(`   📝 Asset versionado: ${file} -> v=${hash}`);
                } else {
                    log.info(`   ⚠️ Arquivo não encontrado para versionamento: ${file}`);
                }
            } catch (error) {
                log.info(`   ❌ Erro ao calcular hash de ${file}:`, error);
            }
        }
    }

    /**
     * Retorna a URL versionada de um arquivo (ex: /script.js?v=abcdef)
     */
    static getVersionedUrl(filename: string): string {
        const hash = this.assetHashes.get(filename);
        return hash ? `/${filename}?v=${hash}` : `/${filename}`;
    }



    static injectVersions(htmlContent: string): string {
        let modifiedHtml = htmlContent;

        // Substituir app.js
        const appHash = this.assetHashes.get('app.js');
        if (appHash) {
            modifiedHtml = modifiedHtml.replace(
                'src="app.js"',
                `src="app.js?v=${appHash}"`
            );
        }

        // Substituir style.css
        const styleHash = this.assetHashes.get('style.css');
        if (styleHash) {
            modifiedHtml = modifiedHtml.replace(
                'href="style.css"',
                `href="style.css?v=${styleHash}"`
            );
        }

        return modifiedHtml;
    }
}
