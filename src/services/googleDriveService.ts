import { FirebaseAuthService } from './firebase';

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  createdTime: string;
  size?: string;
  webViewLink?: string;
}

export const GoogleDriveService = {
  getAccessToken(): string | null {
    return FirebaseAuthService.getGoogleAccessToken();
  },

  async ensureChurchFolder(churchName: string, accessToken: string): Promise<string> {
    const cleanChurchName = churchName.trim() || 'Principal';
    const folderName = `Secretaria da Igreja - ${cleanChurchName}`;

    // 1. Search if folder already exists
    const query = `name = '${folderName.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const searchRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!searchRes.ok) {
      const errJson = await searchRes.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || 'Falha ao pesquisar pasta no Google Drive.');
    }

    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }

    // 2. Create new designated church folder
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        description: `Pasta oficial de backups e relatórios da ${cleanChurchName} - Secretaria da Igreja`,
      }),
    });

    if (!createRes.ok) {
      const errJson = await createRes.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || 'Não foi possível criar a pasta no Google Drive.');
    }

    const newFolder = await createRes.json();
    return newFolder.id;
  },

  async uploadBackupToDrive(
    churchName: string,
    fileName: string,
    fileContent: string,
    mimeType: string = 'application/json'
  ): Promise<GoogleDriveFile> {
    const token = this.getAccessToken();
    if (!token) {
      throw new Error('Conecte sua Conta Google primeiro para sincronizar com o Google Drive.');
    }

    const folderId = await this.ensureChurchFolder(churchName, token);

    // Multipart upload
    const boundary = '-------SecretariaIgrejaDriveBoundary' + Date.now();
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelimiter = `\r\n--${boundary}--`;

    const metadata = {
      name: fileName,
      mimeType: mimeType,
      parents: [folderId],
      description: `Backup oficial exportado pela Secretaria da Igreja (${churchName})`,
    };

    const multipartRequestBody =
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      `Content-Type: ${mimeType}\r\n\r\n` +
      fileContent +
      closeDelimiter;

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,createdTime,size,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartRequestBody,
      }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Erro ao enviar backup para o Google Drive.');
    }

    const fileData = await res.json();
    return fileData as GoogleDriveFile;
  },

  async listChurchBackups(churchName: string): Promise<GoogleDriveFile[]> {
    const token = this.getAccessToken();
    if (!token) {
      return [];
    }

    try {
      const folderId = await this.ensureChurchFolder(churchName, token);
      const query = `'${folderId}' in parents and trashed = false`;
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
          query
        )}&fields=files(id,name,mimeType,createdTime,size,webViewLink)&orderBy=createdTime desc`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!res.ok) {
        return [];
      }

      const data = await res.json();
      return (data.files || []) as GoogleDriveFile[];
    } catch (e) {
      console.warn('Erro ao consultar backups no Google Drive:', e);
      return [];
    }
  },

  async downloadBackupContent(fileId: string): Promise<string> {
    const token = this.getAccessToken();
    if (!token) {
      throw new Error('Conecte sua Conta Google para baixar o backup.');
    }

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) {
      throw new Error('Não foi possível obter o conteúdo do arquivo no Google Drive.');
    }

    return await res.text();
  },

  async deleteBackupFromDrive(fileId: string): Promise<void> {
    const token = this.getAccessToken();
    if (!token) {
      throw new Error('Conecte sua Conta Google para gerenciar arquivos.');
    }

    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok && res.status !== 404) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Falha ao remover arquivo do Google Drive.');
    }
  },
};
