"""Accès Google Sheets + Drive pour le worker (mêmes onglets que l'Apps Script).

Authentification :
- dans Google Colab : compte de l'utilisateur (google.colab.auth) ;
- en local : OAuth « application de bureau » (credentials.json → token.json, jamais commités).
"""
from __future__ import annotations

import io
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _credentials():
    try:  # Colab
        from google.colab import auth as colab_auth  # type: ignore

        colab_auth.authenticate_user()
        import google.auth

        creds, _ = google.auth.default(scopes=SCOPES)
        return creds
    except ImportError:
        pass
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow

    here = Path(os.environ.get("FACTORY_SECRETS_DIR", Path(__file__).parent))
    token, secret = here / "token.json", here / "credentials.json"
    creds = None
    if token.exists():
        creds = Credentials.from_authorized_user_file(str(token), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not secret.exists():
                raise SystemExit(f"OAuth : placez credentials.json (client « Application de bureau ») dans {here}")
            creds = InstalledAppFlow.from_client_secrets_file(str(secret), SCOPES).run_local_server(port=0)
        token.write_text(creds.to_json(), encoding="utf-8")
    return creds


def col_letter(n: int) -> str:
    s = ""
    while n > 0:
        n, m = divmod(n - 1, 26)
        s = chr(65 + m) + s
    return s


@dataclass
class Table:
    headers: list[str]
    rows: list[dict] = field(default_factory=list)  # chaque dict contient _row (n° de ligne Sheet)


class Factory:
    """Lecture/écriture de la Sheet tour de contrôle et du Drive."""

    def __init__(self, spreadsheet_id: str):
        self._creds = _credentials()
        self.sid = spreadsheet_id
        self._local = threading.local()  # httplib2 n'est pas thread-safe : un client par thread
        self._folder_cache: dict[tuple[str, str], str] = {}
        self._folder_lock = threading.Lock()

    def _svc(self, name: str, version: str):
        from googleapiclient.discovery import build

        key = f"{name}_{version}"
        if not hasattr(self._local, key):
            setattr(self._local, key, build(name, version, credentials=self._creds, cache_discovery=False))
        return getattr(self._local, key)

    @property
    def sheets(self):
        return self._svc("sheets", "v4")

    @property
    def drive(self):
        return self._svc("drive", "v3")

    # ---------- Sheets ----------
    def table(self, name: str) -> Table:
        res = self.sheets.spreadsheets().values().get(spreadsheetId=self.sid, range=f"{name}!A1:AZ").execute()
        values = res.get("values", [])
        if not values:
            return Table([])
        headers = [str(h) for h in values[0]]
        rows = []
        for i, r in enumerate(values[1:], start=2):
            if not any(str(c).strip() for c in r):
                continue
            d = {h: (r[j] if j < len(r) else "") for j, h in enumerate(headers)}
            d["_row"] = i
            rows.append(d)
        return Table(headers, rows)

    def config(self) -> dict:
        return {r["cle"].strip(): r.get("valeur", "") for r in self.table("Config").rows if r.get("cle")}

    def update_row(self, name: str, headers: list[str], row: int, patch: dict) -> None:
        data = []
        for k, v in patch.items():
            if k in headers:
                c = col_letter(headers.index(k) + 1)
                data.append({"range": f"{name}!{c}{row}", "values": [[v]]})
        if data:
            self.sheets.spreadsheets().values().batchUpdate(
                spreadsheetId=self.sid, body={"valueInputOption": "USER_ENTERED", "data": data}
            ).execute()

    # ---------- Drive ----------
    def download(self, file_id: str, dest: Path) -> Path:
        from googleapiclient.http import MediaIoBaseDownload

        req = self.drive.files().get_media(fileId=file_id, supportsAllDrives=True)
        with io.FileIO(dest, "wb") as fh:
            dl = MediaIoBaseDownload(fh, req, chunksize=16 * 1024 * 1024)
            done = False
            while not done:
                _, done = dl.next_chunk()
        return dest

    def read_text(self, file_id: str) -> str:
        data = self.drive.files().get_media(fileId=file_id, supportsAllDrives=True).execute()
        return data.decode("utf-8-sig")

    def folder(self, parent_id: str, name: str) -> str:
        key = (parent_id, name)
        with self._folder_lock:
            return self._folder_locked(key, parent_id, name)

    def _folder_locked(self, key, parent_id: str, name: str) -> str:
        if key in self._folder_cache:
            return self._folder_cache[key]
        q = (
            f"'{parent_id}' in parents and name = '{name}' and "
            "mimeType = 'application/vnd.google-apps.folder' and trashed = false"
        )
        found = self.drive.files().list(q=q, fields="files(id)", supportsAllDrives=True,
                                        includeItemsFromAllDrives=True).execute().get("files", [])
        fid = found[0]["id"] if found else self.drive.files().create(
            body={"name": name, "mimeType": "application/vnd.google-apps.folder", "parents": [parent_id]},
            fields="id", supportsAllDrives=True,
        ).execute()["id"]
        self._folder_cache[key] = fid
        return fid

    def upload(self, path: Path, folder_id: str, name: str, mime: str) -> dict:
        from googleapiclient.http import MediaFileUpload

        q = f"'{folder_id}' in parents and name = '{name}' and trashed = false"
        for old in self.drive.files().list(q=q, fields="files(id)", supportsAllDrives=True,
                                           includeItemsFromAllDrives=True).execute().get("files", []):
            self.drive.files().update(fileId=old["id"], body={"trashed": True}, supportsAllDrives=True).execute()
        media = MediaFileUpload(str(path), mimetype=mime, resumable=True)
        return self.drive.files().create(
            body={"name": name, "parents": [folder_id]}, media_body=media,
            fields="id, webViewLink", supportsAllDrives=True,
        ).execute()
