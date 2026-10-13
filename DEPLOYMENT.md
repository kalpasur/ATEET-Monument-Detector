# ATEET deployment guide

This repository now separates the public static frontend from the Python/PyTorch inference API.

- **Frontend:** GitHub Pages, built from the `site/` directory by `.github/workflows/pages.yml`.
- **Backend:** Flask + YOLOv5 in `backend/`, containerized for Render.
- **Weights:** downloaded at runtime from the Git LFS media URL. The 173 MB `best.pt` file should not be copied into the Pages artifact.

## 1. Publish the GitHub Pages frontend

1. Merge the deployment changes into `main`.
2. Open **Settings → Pages** in this repository.
3. Set **Build and deployment → Source** to **GitHub Actions**.
4. Open **Actions → Deploy ATEET frontend to GitHub Pages** and confirm the workflow completes.
5. The expected project-site URL is <https://kalpasur.github.io/ATEET-Monument-Detector/>.

The workflow publishes only `site/`, not notebooks, model weights, or thesis files.

## 2. Deploy the Python inference API on Render

The repository includes a Render Blueprint in `render.yaml`. The configured Standard instance is intentional: the model is about 173 MB and PyTorch needs additional RAM for loading and CPU inference. **Review Render's current pricing and the selected plan before creating the service; this blueprint does not create or purchase a service by itself.** A free 512 MB instance is likely to run out of memory.

1. Sign in at <https://dashboard.render.com/>.
2. Choose **New → Blueprint** and connect this repository, or create a Docker Web Service from the repository.
3. If configuring the service manually, use:
   - Dockerfile path: `./backend/Dockerfile`
   - Docker context: repository root (`.`)
   - Health check path: `/health`
   - Environment variable `MODEL_URL`: `https://media.githubusercontent.com/media/kalpasur/ATEET-Monument-Detector/main/best.pt`
   - Environment variable `ALLOWED_ORIGINS`: `https://kalpasur.github.io`
4. Deploy and wait for the service to become healthy. Open `https://YOUR-SERVICE.onrender.com/health`; it should return JSON with `"status":"ok"`. The model loads on the first prediction, not during the health check.

### Model-weight retrieval

`best.pt` is tracked by Git LFS. The normal raw GitHub file URL may return the small LFS pointer text instead of the binary. The backend therefore defaults to the GitHub LFS media URL. The downloader rejects tiny responses and LFS pointer files. If the model is moved, set `MODEL_URL` to a direct URL that returns the actual weight file (not a Git LFS pointer or HTML page).

## 3. Connect the Pages frontend to the API

After Render assigns the API URL, edit `site/config.js` and set:

```js
window.ATEET_CONFIG = {
  API_BASE_URL: "https://YOUR-SERVICE.onrender.com"
};
```

Commit and push the change to `main`. The Pages workflow redeploys the frontend automatically. Alternatively, a visitor can set the API URL under **Inference server settings** in their own browser; that setting is stored locally in that browser.

## 4. Verify end to end

1. Open the Pages URL and confirm the interface loads.
2. Open the backend `/health` URL and confirm it returns `status: ok`.
3. Upload a small JPG/PNG/WEBP image and run inference.
4. On the first prediction, allow time for the 173 MB model to download and initialize.
5. Confirm the annotated image, detections, and confidence values appear.

## Important notes

- GitHub Pages cannot execute Flask, Python, or PyTorch. It serves only the static UI; inference must run on the backend.
- The current API is CPU-only. Expect slower inference than a GPU deployment.
- Render free web services sleep after 15 minutes without traffic and can take about a minute to wake. They also have limited memory and ephemeral storage; this model is not a good fit for a 512 MB free instance.
- The frontend sends images to your configured backend. Avoid uploading sensitive imagery unless you control and trust that service.
- The backend pins the YOLOv5 source to v6.2 to avoid the original application's missing local `yolov5/` directory. If the checkpoint was trained against a different YOLOv5 revision, update the tag only after testing the checkpoint in that revision.
- This setup does not promise the model will load successfully until the deployed backend downloads the actual LFS object and a real image is tested. Review Render logs if the first inference fails.
