const { RouterOSAPI } = require('node-routeros');

class MikroTikService {
  constructor() {
    this.host = process.env.MIKROTIK_HOST || 'sg-17.hostddns.us';
    this.port = parseInt(process.env.MIKROTIK_PORT || '13948');
    this.user = process.env.MIKROTIK_USER || 'admin';
    this.password = process.env.MIKROTIK_PASSWORD || '';
    this.conn = null;
  }

  async connect() {
    if (this.conn) return this.conn;
    
    this.conn = new RouterOSAPI({
      host: this.host,
      port: this.port,
      user: this.user,
      password: this.password,
      timeout: 10
    });

    try {
      await this.conn.connect();
      console.log(`[MikroTik] Connected to ${this.host}:${this.port}`);
      return this.conn;
    } catch (err) {
      this.conn = null;
      console.error('[MikroTik] Connection failed:', err.message);
      throw err;
    }
  }

  async disconnect() {
    if (this.conn) {
      try {
        await this.conn.close();
      } catch (_) {}
      this.conn = null;
    }
  }

  // Generate random voucher code like "GAME-XXXX"
  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'GAME-';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Create hotspot user (voucher) on MikroTik
  async createVoucher(code, limitUptime, profile) {
    const conn = await this.connect();

    try {
      // Add hotspot user
      const result = await conn.write('/ip/hotspot/user/add', [
        `=name=${code}`,
        `=password=${code}`,
        `=limit-uptime=${limitUptime}`,
        `=profile=${profile}`,
        `=comment=MathArcade-Reward`
      ]);

      console.log(`[MikroTik] Voucher created: ${code} (${limitUptime}, profile: ${profile})`);
      return { success: true, code, limitUptime, profile };
    } catch (err) {
      console.error('[MikroTik] Create voucher failed:', err.message);
      throw err;
    }
  }

  // Check if MikroTik is reachable
  async healthCheck() {
    try {
      const conn = await this.connect();
      const identity = await conn.write('/system/identity/print');
      return { 
        status: 'connected', 
        router: identity[0]?.name || 'unknown' 
      };
    } catch (err) {
      return { status: 'disconnected', error: err.message };
    }
  }
}

module.exports = new MikroTikService();
