from flask import Flask, request, jsonify
from pathlib import Path
import hashlib
import os

app = Flask(__name__)

BASE_FOLDER = Path(r"D:\Downloads\Ramo").resolve()


@app.post("/upload")
def upload_file():
    uploaded_file = request.files.get("file")
    relative_folder = request.form.get("relative_folder", "")
    final_filename = request.form.get("final_filename", "")
    job_id = request.form.get("job_id", "")
    attachment_id = request.form.get("attachment_id", "")

    if not uploaded_file:
        return jsonify({
            "success": False,
            "error": "Missing file"
        }), 400

    if not relative_folder:
        return jsonify({
            "success": False,
            "error": "Missing relative_folder"
        }), 400

    if not final_filename:
        return jsonify({
            "success": False,
            "error": "Missing final_filename"
        }), 400

    # The filename must not contain another folder path.
    if Path(final_filename).name != final_filename:
        return jsonify({
            "success": False,
            "error": "Invalid final_filename"
        }), 400

    relative_path = Path(relative_folder.replace("\\", "/"))

    # Prevent paths such as ../../Windows.
    if relative_path.is_absolute() or ".." in relative_path.parts:
        return jsonify({
            "success": False,
            "error": "Invalid relative_folder"
        }), 400

    destination_folder = (BASE_FOLDER / relative_path).resolve()

    try:
        if os.path.commonpath([
            str(BASE_FOLDER),
            str(destination_folder)
        ]) != str(BASE_FOLDER):
            raise ValueError("Folder is outside the allowed base folder")
    except ValueError:
        return jsonify({
            "success": False,
            "error": "Folder is outside the allowed base folder"
        }), 400

    destination_folder.mkdir(parents=True, exist_ok=True)

    final_path = destination_folder / final_filename
    temporary_path = destination_folder / f"{final_filename}.part"

    # Never silently overwrite an existing production file.
    if final_path.exists():
        return jsonify({
            "success": False,
            "error": "File already exists",
            "saved_path": str(final_path)
        }), 409

    sha256 = hashlib.sha256()
    total_size = 0

    try:
        with temporary_path.open("wb") as output:
            while True:
                chunk = uploaded_file.stream.read(1024 * 1024)

                if not chunk:
                    break

                output.write(chunk)
                sha256.update(chunk)
                total_size += len(chunk)

        # Atomic move from temporary file to completed file.
        os.replace(temporary_path, final_path)

    except Exception as error:
        if temporary_path.exists():
            temporary_path.unlink()

        return jsonify({
            "success": False,
            "error": str(error)
        }), 500

    return jsonify({
        "success": True,
        "job_id": job_id,
        "attachment_id": attachment_id,
        "final_filename": final_filename,
        "saved_path": str(final_path),
        "relative_path": str(final_path.relative_to(BASE_FOLDER)),
        "file_size": total_size,
        "checksum_sha256": sha256.hexdigest()
    }), 201


@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "base_folder": str(BASE_FOLDER)
    })


if __name__ == "__main__":
    print(f"Ramo receiver saving files to: {BASE_FOLDER}")
    app.run(host="127.0.0.1", port=8787, debug=False)