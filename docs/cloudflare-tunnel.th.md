# ReelFire ผ่าน Cloudflare Tunnel

**4udevstudio By Firework**

คู่มือนี้เปิดเว็บ ReelFire ให้คนนอกเข้าได้ผ่าน Cloudflare Tunnel โดยไม่ต้องเปิดพอร์ตเราเตอร์ เครื่องที่รัน GPU เป็นคนเปิดอุโมงค์เอง

Based on Ai-H3-Studio-Generator by Ton (MIT) ใบอนุญาตต้นทางใน `LICENSE` ไม่ได้แก้

อุโมงค์เผยแพร่เฉพาะเว็บ Next.js ที่ `http://localhost:3000` FastAPI (`127.0.0.1:8000`) และ ComfyUI (`127.0.0.1:8188`) ไม่ถูกใส่ใน ingress

ตัวอย่างคอนฟิก: `deploy/cloudflared/config.example.yml`  
hostname ตัวอย่าง: `reelfire.example.com`  
ชื่อบริการตัวอย่างของ API: `reelfire-backend`

---

## 1. สิ่งที่ต้องมี

- โดเมนที่เพิ่มใน Cloudflare แล้ว (เนมเซิร์ฟเวอร์ชี้มาที่ Cloudflare)
- เครื่อง Windows หรือ Linux ที่รัน ReelFire และมี GPU
- บัญชี Cloudflare ที่จัดการโดเมนนั้นได้

อย่า commit ไฟล์ credentials (`*.json` ของ tunnel) หรือโทเคนใด ๆ

---

## 2. ติดตั้ง cloudflared

### Windows

1. ดาวน์โหลดตัวติดตั้งจาก https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
2. ติดตั้งแล้วเปิด PowerShell ใหม่
3. ตรวจเวอร์ชัน:

```powershell
cloudflared --version
```

### Linux

Debian / Ubuntu:

```bash
curl -L --output cloudflared.deb https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared.deb
cloudflared --version
```

แพ็กเกจอื่นดูได้ที่หน้าดาวน์โหลดของ Cloudflare

---

## 3. ล็อกอินและสร้างอุโมงค์

คำสั่งเดียวกันทั้ง Windows และ Linux (บน Linux ใส่ `sudo` เมื่อต้องเขียนไฟล์ใน `/etc`)

```bash
cloudflared tunnel login
```

เบราว์เซอร์จะเปิดให้เลือกโดเมน หลังสำเร็จจะได้ไฟล์ `cert.pem` ในโฟลเดอร์ `.cloudflared` ของผู้ใช้ ไฟล์นี้เป็นใบอนุญาตสร้างอุโมงค์ ไม่ใช่ไฟล์ที่เอาขึ้น git

```bash
cloudflared tunnel create reelfire
```

จด **Tunnel ID** ที่คำสั่งพิมพ์ออกมา และที่อยู่ไฟล์ credentials (`<TUNNEL_ID>.json`)

ผูก DNS:

```bash
cloudflared tunnel route dns reelfire reelfire.example.com
```

เปลี่ยน `reelfire.example.com` เป็นโฮสต์จริงของคุณ คำสั่งนี้สร้างระเบียน CNAME ชี้มาที่อุโมงค์

---

## 4. ไฟล์คอนฟิก

คัดลอก `deploy/cloudflared/config.example.yml` ไปที่เครื่อง เช่น

- Linux: `/etc/cloudflared/config.yml`
- Windows: `C:\Windows\System32\config\systemprofile\.cloudflared\config.yml` (เมื่อรันเป็น service) หรือโฟลเดอร์ที่ `cloudflared` บอกตอนติดตั้ง

แก้สามจุดให้เป็นของจริง:

- `tunnel:` เป็น Tunnel ID
- `credentials-file:` เป็นพาธของ `<TUNNEL_ID>.json`
- `hostname:` เป็นชื่อที่เพิ่ง route DNS

ingress ต้องมีแค่เว็บ แล้วปิดท้ายด้วย catch-all:

```yaml
ingress:
  - hostname: reelfire.example.com
    service: http://localhost:3000
  - service: http_status:404
```

ไม่มีบรรทัดที่ชี้ไปพอร์ต 8000 หรือ 8188

ทดสอบก่อนติดตั้งเป็นบริการ:

```bash
cloudflared tunnel --config /etc/cloudflared/config.yml run
```

เปิด `https://reelfire.example.com` ต้องเห็นหน้าเว็บ ReelFire

---

## 5. รันเป็นบริการ

### Windows

วางคอนฟิกและไฟล์ credentials ให้บัญชี Local System อ่านได้ แล้ว:

```powershell
cloudflared service install
```

บริการชื่อ `cloudflared` จะถูกสร้างใน Services เริ่มใหม่อัตโนมัติหลังรีบูต

```powershell
sc query cloudflared
```

### Linux (systemd)

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

API ของ ReelFire แยกจาก cloudflared ถ้าจะให้ uvicorn เป็นบริการของตัวเอง ให้ตั้งชื่อหน่วยว่า `reelfire-backend` เช่น `/etc/systemd/system/reelfire-backend.service`

```ini
[Unit]
Description=ReelFire API
After=network.target

[Service]
WorkingDirectory=/opt/reelfire/backend
EnvironmentFile=/opt/reelfire/.env
ExecStart=/opt/reelfire/backend/venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

พาธ `/opt/reelfire` เป็นเพียงตัวอย่าง ใช้โฟลเดอร์ที่ clone โปรเจกต์จริง แล้ว `systemctl enable --now reelfire-backend`

`ExecStart` ต้องเป็น `127.0.0.1` ไม่ใช่ `0.0.0.0`

---

## 6. ตรวจว่า 8000 และ 8188 ไม่โผล่ออกอินเทอร์เน็ต

บนเครื่อง GPU:

- สคริปต์ `start.sh` / `start.bat` / `backend/run.sh` ผูก uvicorn ที่ `127.0.0.1`
- เปิด ComfyUI ด้วย `--listen 127.0.0.1` ไม่ใช้ `--listen 0.0.0.0`

จากเครื่องอื่นในอินเทอร์เน็ต (ไม่ใช่เครื่องตัวเอง) ลอง:

```bash
curl -m 5 http://<public-ip>:8000/health
curl -m 5 http://<public-ip>:8188
```

ทั้งคู่ต้องติดต่อไม่ได้ (timeout หรือ connection refused) เข้าเว็บได้ทาง `https://reelfire.example.com` เท่านั้น

บนเครื่องตัวเอง `curl http://127.0.0.1:8000/health` ยังต้องตอบได้

---

## 7. URL สาธารณะและคุกกี้

ใน `.env` ของ Next.js ตั้งค่าให้ตรงกับโฮสต์ที่อุโมงค์ประกาศ เช่น

```bash
# ตัวอย่าง ไม่ใช่ค่าจริง
APP_URL=https://reelfire.example.com
```

คุกกี้เซสชันเป็น `Secure` เมื่อผู้ใช้เข้าผ่าน HTTPS หรือเมื่อมี `X-Forwarded-Proto: https` ซึ่ง Cloudflare Tunnel ส่งให้ บน `localhost` คุกกี้ไม่บังคับ Secure เพื่อให้พัฒนาในเครื่องได้

อย่าตั้ง `NEXT_PUBLIC_BACKEND_URL` เป็น `:8000` ของเครื่อง GPU เบราว์เซอร์ต้องเรียก FastAPI ผ่านเว็บที่ล็อกอินแล้ว ไม่ใช่ยิงพอร์ต API โดยตรง

---

## 8. ชั้นเพิ่ม: Cloudflare Access (ไม่บังคับ)

Zero Trust สามารถบังคับให้คนเข้าโดเมนยืนยันอีเมลก่อนถึงหน้าล็อกอินของ ReelFire

1. เปิด Cloudflare Zero Trust → Access → Applications → Add an application → Self-hosted
2. โดเมน `reelfire.example.com`
3. สร้างนโยบาย Allow แบบ Emails หรือ One-time PIN แล้วใส่รายชื่ออีเมลที่อนุญาต
4. บันทึก แล้วลองเปิดโฮสต์ในหน้าต่างไม่ระบุตัวตน ต้องขึ้นหน้า OTP ก่อนถึง ReelFire

ชั้นนี้ไม่แทนที่ล็อกอินในแอป เป็นด่านแรกเท่านั้น

---

## 9. แก้ปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| หน้า 404 จาก Cloudflare ทั้งที่เว็บรันอยู่ | hostname ในคอนฟิกไม่ตรงกับ DNS หรือลืม catch-all `http_status:404` ทับกฎที่ถูก |
| `cloudflared` ขึ้น credentials file not found | `credentials-file` ชี้ผิด หรือบริการรันคนละผู้ใช้กับตอน `tunnel create` |
| เว็บขึ้นแต่สร้างวิดีโอไม่ได้ | FastAPI หรือ ComfyUI ไม่ได้รันบนเครื่องเดียวกัน หรือ ComfyUI ไม่ได้ `--listen 127.0.0.1` |
| ล็อกอินแล้วเด้งออกทันที | คุกกี้ Secure ไม่ถูกตั้ง เพราะเข้าผ่าน HTTP โดยไม่ผ่านอุโมงค์ |
| คนนอกเปิดพอร์ต 8000 ได้ | uvicorn ยังฟัง `0.0.0.0` หรือไฟร์วอลล์เปิดพอร์ตนั้น กลับไปใช้ `127.0.0.1` |
| บริการ Windows ไม่ยอมสตาร์ท | รัน `cloudflared service uninstall` แล้วติดตั้งใหม่หลังวางคอนฟิกให้ Local System |

ดูล็อก:

```bash
sudo journalctl -u cloudflared -n 80 --no-pager
sudo journalctl -u reelfire-backend -n 80 --no-pager
```
