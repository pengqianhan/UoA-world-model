// Makes public/models/walker.glb, the walker's figure, from Quaternius's "Animated Human" (CC0):
// https://opengameart.org/content/animated-human-low-poly. Unzip that download and pass the folder:
//
//   node scripts/walker/make-figure.ts "<folder>/Animated Human by @Quaternius"
//
// The model is drawn from a strip of flat colours, its UVs each pointing at one band. This keeps
// that idea but sorts the faces into eight bands (PALETTE below) by what they cover, so an outfit
// can colour shoes and sleeves as well as skin, hair, shirt and trousers; Figure paints the strip.
// It keeps three of the nine animations (idle, walk and run), scales the figure to 1.75 m with its
// feet at the origin, turns it to face north (-z), and writes it as one binary glTF file. The work
// is done in a browser page, where three.js has its FBX loader and glTF exporter.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(ROOT, "public/models/walker.glb");
const folder = process.argv[2];
const fbxFile = folder && path.join(folder, "FBX", "Animated Human.fbx");
if (!fbxFile || !fs.existsSync(fbxFile)) {
  console.error('Pass the unzipped "Animated Human by @Quaternius" folder; see the top of this file.');
  process.exit(1);
}

// A page that can import three.js from node_modules, and the model file.
const server = http.createServer((req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  let file: string | undefined;
  if (url === "/model.fbx") file = fbxFile;
  else if (url.startsWith("/three/")) file = path.join(ROOT, "node_modules/three", path.normalize(url.slice(7)));
  if (url === "/") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end('<!doctype html><script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/examples/jsm/":"/three/examples/jsm/"}}</script>');
    return;
  }
  if (!file || !fs.existsSync(file)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": file.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const port = (server.address() as { port: number }).port;

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.error(e.message));
  await page.goto(`http://127.0.0.1:${port}/`);
  const result = await page.evaluate(async () => {
    const THREE = await import("three");
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
    const fbx = await new FBXLoader().loadAsync("/model.fbx");
    const mesh = fbx.getObjectByProperty("isSkinnedMesh", true) as InstanceType<typeof THREE.SkinnedMesh>;
    const g = mesh.geometry;
    const uv = g.getAttribute("uv");
    const index = g.getAttribute("skinIndex");
    const weight = g.getAttribute("skinWeight");
    const bones = mesh.skeleton.bones.map((b) => b.name);

    // The source strip is 32 rows: skin, eyes and brows, hair, shirt, trousers.
    const sourceBand = (v: number) => {
      const row = Math.floor((1 - v) * 32);
      return row < 6 ? "skin" : row < 11 ? "eyes" : row < 17 ? "hair" : row < 23 ? "top" : "bottom";
    };
    // Must match PALETTE in src/scene/figure.ts.
    const PALETTE = ["skin", "eyes", "hair", "top", "bottom", "shoes", "upperArm", "forearm"];
    const strongest = (i: number) => {
      let best = 0;
      for (let j = 1; j < 4; j++) if (weight.getComponent(i, j) > weight.getComponent(i, best)) best = j;
      return bones[index.getComponent(i, best)] ?? "";
    };
    const counts: Record<string, number> = {};
    for (let f = 0; f < uv.count / 3; f++) {
      let band = sourceBand(uv.getY(f * 3));
      if (band === "skin") {
        // Bare skin is sorted by the bone that moves most of the face's corners.
        const votes: Record<string, number> = {};
        for (let k = 0; k < 3; k++) {
          const b = strongest(f * 3 + k);
          const kind = /Foot|Toe|Leg/.test(b) ? "shoes" : /ForeArm/.test(b) ? "forearm" : /(Left|Right)Arm$/.test(b) ? "upperArm" : "skin";
          votes[kind] = (votes[kind] ?? 0) + 1;
        }
        band = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]![0];
      }
      counts[band] = (counts[band] ?? 0) + 1;
      const v = 1 - (PALETTE.indexOf(band) + 0.5) / PALETTE.length;
      for (let k = 0; k < 3; k++) uv.setXY(f * 3 + k, 0.5, v);
    }
    mesh.material = new THREE.MeshStandardMaterial({ name: "palette" });
    mesh.castShadow = true;

    // 1.75 m tall, feet on the ground, facing north.
    fbx.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(mesh);
    const height = box.max.y - box.min.y;
    const s = 1.75 / height;
    const root = new THREE.Group();
    root.name = "walker";
    root.add(fbx);
    fbx.scale.setScalar(s);
    fbx.rotation.y = Math.PI;
    fbx.position.y = -box.min.y * s;

    // Idle, walk and run, turning bones only (and the hips' bob); scale tracks hold at 1.
    const keep: Record<string, string> = { "Human Armature|Idle": "idle", "Human Armature|Walk": "walk", "Human Armature|Run": "run" };
    const clips = fbx.animations
      .filter((c) => keep[c.name])
      .map((c) => {
        const clip = c.clone();
        clip.name = keep[c.name]!;
        clip.tracks = clip.tracks.filter((t) => t.name.endsWith(".quaternion") || t.name === "Hips.position");
        return clip;
      });

    const glb = (await new GLTFExporter().parseAsync(root, { binary: true, animations: clips })) as ArrayBuffer;
    const bytes = new Uint8Array(glb);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { glb: btoa(bin), counts, height, clips: clips.map((c) => `${c.name} ${c.duration.toFixed(2)} s, ${c.tracks.length} tracks`) };
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, Buffer.from(result.glb, "base64"));
  console.log(`Wrote ${path.relative(ROOT, OUT)}, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB.`);
  console.log(`Faces by band: ${JSON.stringify(result.counts)}`);
  console.log(`Clips: ${result.clips.join("; ")}`);
} finally {
  await browser.close();
  server.close();
}
