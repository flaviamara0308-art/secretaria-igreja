import { FirebaseAuthService } from './firebase';

export interface SendEmailPayload {
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
}

export const GmailService = {
  getAccessToken(): string | null {
    return FirebaseAuthService.getGoogleAccessToken();
  },

  async sendEmail(payload: SendEmailPayload): Promise<{ id: string; threadId: string }> {
    const token = this.getAccessToken();
    if (!token) {
      throw new Error('Conecte sua Conta Google com permissão de envio para utilizar o Gmail.');
    }

    const { to, subject, bodyText, bodyHtml } = payload;
    if (!to || !subject) {
      throw new Error('Destinatário e assunto são obrigatórios para enviar pelo Gmail.');
    }

    // Build RFC 2822 email message
    const utf8Subject = `=?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;
    const messageParts = [
      `To: ${to}`,
      `Subject: ${utf8Subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      bodyHtml || bodyText.replace(/\n/g, '<br/>'),
    ];
    const message = messageParts.join('\r\n');

    // Base64url encode
    const encodedMessage = btoa(unescape(encodeURIComponent(message)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        raw: encodedMessage,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Falha ao enviar e-mail via Gmail API.');
    }

    return await res.json();
  },
};
