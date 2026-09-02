'use strict';

const crypto = require('crypto');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const {spawnSync} = require('child_process');

const ROOT = path.join(__dirname, '..');
const HOST = path.join(ROOT, 'mobile', 'android-host');
const MAIN = path.join(HOST, 'android', 'app', 'src', 'main');
const JNI_ROOT = path.join(MAIN, 'jniLibs');
const ASSET_ROOT = path.join(MAIN, 'assets', 'clamav');
const CACHE_ROOT = path.resolve(process.env.SONGLESS_ANDROID_CACHE
  || path.join(os.tmpdir(), 'songless-android-antivirus'));
const REPOSITORY = 'https://packages.termux.dev/apt/termux-main/';
const CLAMAV_DATABASE = 'https://database.clamav.net/';

const DEFINITIONS = {
  'main.cvd': '0b2182d229f46981ec8f535382222f7c9dfdd656b250ad47988b910a8d302365',
  'daily.cvd': '69f9633040010c14fe92fb243ccd374b4f6643b7b041883354e21b4b69f0fbdd',
};

const COMMON = {
  clamav: '1.5.4',
  'json-c': '0.19',
  'libandroid-support': '29-1',
  libbz2: '1.0.8-8',
  'libc++': '29',
  libiconv: '1.18-1',
  libicu: '78.3',
  libxml2: '2.15.3-2',
  openssl: '1:3.6.3',
  pcre2: '10.47',
  zlib: '1.3.2',
};

const PACKAGES = {
  'arm64-v8a': {
    termuxArch: 'aarch64',
    files: {
      clamav: ['pool/main/c/clamav/clamav_1.5.4_aarch64.deb', 'd9fe5dc650ba70c4ba3f006ba394c45bcebafba0b4674cdaaf5e09b16cc859d0'],
      'json-c': ['pool/main/j/json-c/json-c_0.19_aarch64.deb', '894fef1e1001807e862f909cd5645dbb51bc77434779124f69178efe13690655'],
      'libandroid-support': ['pool/main/liba/libandroid-support/libandroid-support_29-1_aarch64.deb', 'f2f145d6135ad4843ac9670153be3e3944dc1e6f1736d46d2306c28f2b86f517'],
      libbz2: ['pool/main/libb/libbz2/libbz2_1.0.8-8_aarch64.deb', '4335d7f060650b0aabef545d1334c2f9f280223d5962e13c24a00ec934b794ba'],
      'libc++': ['pool/main/libc/libc++/libc++_29_aarch64.deb', 'bb9f12113c137aa0e8513bb51cc49fe77a5ce3ca39ab9e92c57d228ecdf00222'],
      libiconv: ['pool/main/libi/libiconv/libiconv_1.18-1_aarch64.deb', 'b19e6f348034bb48d2a5590b5cb242769f682c476717374d134d004cc663dc84'],
      libicu: ['pool/main/libi/libicu/libicu_78.3_aarch64.deb', 'f536403f65a08fe0df6e7304184e902d54def77d5c3bd5edfd9109d57601d276'],
      libxml2: ['pool/main/libx/libxml2/libxml2_2.15.3-2_aarch64.deb', '59fbced0c60a7df9ff84faf20d248f563da5ae45a6783ed683faf33e9010fb24'],
      openssl: ['pool/main/o/openssl/openssl_1:3.6.3_aarch64.deb', '86760e9ce736f463236f2c15b1eb3a3fdcfc5778d0fd7077a917448dcc90f3aa'],
      pcre2: ['pool/main/p/pcre2/pcre2_10.47_aarch64.deb', '51f915d22de639bfca6ec029ae613987bbe3bc73626eede13319fd2e95f50b63'],
      zlib: ['pool/main/z/zlib/zlib_1.3.2_aarch64.deb', '75e7d0af17fcc3b40004309fdc00a1ddb9ae08346dce5e269902c34ac3966ac9'],
    },
  },
  x86_64: {
    termuxArch: 'x86_64',
    files: {
      clamav: ['pool/main/c/clamav/clamav_1.5.4_x86_64.deb', '6afa51199f06396a8bb41dd4af9b994e94419688c086c29553dc4d78b5237418'],
      'json-c': ['pool/main/j/json-c/json-c_0.19_x86_64.deb', '3817e1da4df01e43bf471ece32a8ae36327a3e56e293ec140a722de9aeb3d672'],
      'libandroid-support': ['pool/main/liba/libandroid-support/libandroid-support_29-1_x86_64.deb', '665900760c05959ec076082a0941f05bd452f301e5a70bdfa7383fd3404d44d5'],
      libbz2: ['pool/main/libb/libbz2/libbz2_1.0.8-8_x86_64.deb', 'f6f81d38a40c1626202da1e87727e5a3e6de296b1c0eb252af8948646b164ca0'],
      'libc++': ['pool/main/libc/libc++/libc++_29_x86_64.deb', 'a4325afa2ecde73742499766e2a46202003e5cb3dcd2b7773ae25f386f3fecfa'],
      libiconv: ['pool/main/libi/libiconv/libiconv_1.18-1_x86_64.deb', 'c171356580d85f58d3eedc9c5f49b563d80afb18c92cbbb0382295d539bc0719'],
      libicu: ['pool/main/libi/libicu/libicu_78.3_x86_64.deb', '19fa8c4d828719f465d523983b1e0d833e4130bb22790104638965d97e27fe60'],
      libxml2: ['pool/main/libx/libxml2/libxml2_2.15.3-2_x86_64.deb', '02b1fbd39314c373166388943ba9b994cc4d0fb363eb4ab01f33b0e782aad5af'],
      openssl: ['pool/main/o/openssl/openssl_1:3.6.3_x86_64.deb', 'b58fedf8d3accda418b69b636bb1f8b789a5a75a375bda4a1c4fccb2c6e30380'],
      pcre2: ['pool/main/p/pcre2/pcre2_10.47_x86_64.deb', '8e4fb14ba014f9b2d5e07b6ed9c519b31d00a6e7ddeb5804c3b076a6c841c2fb'],
      zlib: ['pool/main/z/zlib/zlib_1.3.2_x86_64.deb', 'c61b089dd30981452f5953b2bad4c4e7857062b2abd971f87fb0aec441bc02f4'],
    },
  },
};

const TARGETS = {
  clamav: [
    ['bin/clamscan', 'libclamscan_exec.so'],
    ['lib/libclamav.so', 'libclamav.so'],
    ['lib/libclammspack.so', 'libclammspack.so'],
    ['lib/libclamunrar.so', 'libclamunrar.so'],
    ['lib/libclamunrar_iface.so', 'libclamunrar_iface.so'],
  ],
  'json-c': [['lib/libjson-c.so', 'libjson-c.so']],
  'libandroid-support': [['lib/libandroid-support.so', 'libandroid-support.so']],
  libbz2: [['lib/libbz2.so.1.0.8', 'libbz210.so']],
  'libc++': [['lib/libc++_shared.so', 'libslcxx.so']],
  libiconv: [['lib/libiconv.so', 'libiconv.so']],
  libicu: [
    ['lib/libicuuc.so.78.3', 'libicuuc78.so'],
    ['lib/libicudata.so.78.3', 'libicudata78.so'],
  ],
  libxml2: [['lib/libxml2.so.16.1.3', 'libxml216.so']],
  openssl: [
    ['lib/libssl.so.3', 'libssl3.so'],
    ['lib/libcrypto.so.3', 'libcrypto3.so'],
  ],
  pcre2: [['lib/libpcre2-8.so', 'libpcre2-8.so']],
  zlib: [['lib/libz.so.1.3.2', 'libz1.so']],
};

const ELF_REPLACEMENTS = {
  'libbz2.so.1.0': 'libbz210.so',
  'libc++_shared.so': 'libslcxx.so',
  'libcrypto.so.3': 'libcrypto3.so',
  'libicudata.so.78': 'libicudata78.so',
  'libicuuc.so.78': 'libicuuc78.so',
  'libssl.so.3': 'libssl3.so',
  'libxml2.so.16': 'libxml216.so',
  'libz.so.1': 'libz1.so',
};

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function download(url, destination, options = {}) {
  const redirects = Number(options.redirects) || 0;
  if (redirects > 5) return Promise.reject(new Error(`Trop de redirections : ${url}`));
  return new Promise((resolve, reject) => {
    const request = https.get(url, {headers: {
      'User-Agent': options.userAgent || 'Songless Android builder/1.0',
    }}, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, url).href;
        download(next, destination, {...options, redirects: redirects + 1}).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Téléchargement refusé (${response.statusCode}) : ${url}`));
        return;
      }
      const partial = `${destination}.partial`;
      const output = fs.createWriteStream(partial);
      response.pipe(output);
      output.on('finish', () => output.close(() => {
        fs.renameSync(partial, destination);
        resolve();
      }));
      output.on('error', reject);
    });
    request.setTimeout(120000, () => request.destroy(new Error('Téléchargement expiré.')));
    request.on('error', reject);
  });
}

function safeGeneratedPath(candidate, expectedParent) {
  const resolved = path.resolve(candidate);
  if (path.dirname(resolved) !== path.resolve(expectedParent)) {
    throw new Error(`Destination générée refusée : ${resolved}`);
  }
  return resolved;
}

function tar(args, options = {}) {
  const result = spawnSync('tar', args, {
    encoding: null,
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString('utf8').trim() : result.error;
    throw new Error(`Extraction tar impossible : ${detail || result.status}`);
  }
  return result.stdout;
}

function patchElf(file) {
  const bytes = fs.readFileSync(file);
  for (const [before, after] of Object.entries(ELF_REPLACEMENTS)) {
    if (after.length > before.length) throw new Error(`Nom ELF trop long : ${after}`);
    const needle = Buffer.from(before, 'ascii');
    const replacement = Buffer.alloc(before.length);
    replacement.write(after, 'ascii');
    let offset = 0;
    while ((offset = bytes.indexOf(needle, offset)) !== -1) {
      replacement.copy(bytes, offset);
      offset += needle.length;
    }
  }
  fs.writeFileSync(file, bytes);
}

async function packageFile(abi, packageName, definition) {
  const [, expectedHash] = definition;
  const cacheFile = path.join(CACHE_ROOT, `${abi}-${packageName.replace(/[^a-z0-9-]/gi, '_')}.deb`);
  if (!fs.existsSync(cacheFile) || sha256(cacheFile) !== expectedHash) {
    fs.rmSync(cacheFile, {force: true});
    await download(new URL(definition[0], REPOSITORY).href, cacheFile);
  }
  const actual = sha256(cacheFile);
  if (actual !== expectedHash) throw new Error(`SHA-256 invalide pour ${packageName} (${abi}).`);
  return cacheFile;
}

function extractDataArchive(deb, abi, packageName) {
  const directory = path.join(CACHE_ROOT, 'opened', abi, packageName.replace(/[^a-z0-9-]/gi, '_'));
  fs.rmSync(directory, {recursive: true, force: true});
  fs.mkdirSync(directory, {recursive: true});
  tar(['-xf', deb, '-C', directory, 'data.tar.xz']);
  return path.join(directory, 'data.tar.xz');
}

function extractFile(dataArchive, relative, destination) {
  const archivePath = `./data/data/com.termux/files/usr/${relative}`;
  const bytes = tar(['-xOf', dataArchive, archivePath]);
  if (!bytes || bytes.length === 0) throw new Error(`Fichier vide dans le paquet : ${archivePath}`);
  fs.writeFileSync(destination, bytes);
}

async function buildAbi(abi, config) {
  const destination = path.join(JNI_ROOT, abi);
  fs.mkdirSync(destination, {recursive: true});
  for (const [packageName, definition] of Object.entries(config.files)) {
    if (COMMON[packageName] === undefined) throw new Error(`Paquet non documenté : ${packageName}`);
    const deb = await packageFile(abi, packageName, definition);
    const dataArchive = extractDataArchive(deb, abi, packageName);
    for (const [source, output] of TARGETS[packageName]) {
      const target = path.join(destination, output);
      extractFile(dataArchive, source, target);
      patchElf(target);
    }
    if (packageName === 'clamav' && abi === 'arm64-v8a') {
      fs.mkdirSync(path.join(ASSET_ROOT, 'certs'), {recursive: true});
      extractFile(dataArchive, 'etc/clamav/certs/clamav.crt', path.join(ASSET_ROOT, 'certs', 'clamav.crt'));
    }
    console.log(`OK ${abi} · ${packageName} ${COMMON[packageName]}`);
  }
}

async function buildDefinitions() {
  const sourceDirectory = process.env.SONGLESS_CLAMAV_DATABASE_SOURCE
    ? path.resolve(process.env.SONGLESS_CLAMAV_DATABASE_SOURCE) : null;
  const destination = path.join(ASSET_ROOT, 'db');
  const cache = path.join(CACHE_ROOT, 'definitions');
  fs.mkdirSync(destination, {recursive: true});
  fs.mkdirSync(cache, {recursive: true});
  for (const [name, expectedHash] of Object.entries(DEFINITIONS)) {
    const source = sourceDirectory ? path.join(sourceDirectory, name) : path.join(cache, name);
    if (!fs.existsSync(source) || sha256(source) !== expectedHash) {
      if (sourceDirectory) throw new Error(`Base ClamAV locale absente ou invalide : ${name}`);
      fs.rmSync(source, {force: true});
      await download(new URL(name, CLAMAV_DATABASE).href, source, {
        userAgent: 'ClamAV/1.5.4 (OS: linux-android, ARCH: aarch64, CPU: aarch64)',
      });
    }
    if (sha256(source) !== expectedHash) throw new Error(`SHA-256 invalide pour ${name}.`);
    fs.copyFileSync(source, path.join(destination, name));
    console.log(`OK base intégrée · ${name}`);
  }
}

async function build() {
  safeGeneratedPath(JNI_ROOT, path.join(MAIN));
  safeGeneratedPath(ASSET_ROOT, path.join(MAIN, 'assets'));
  fs.mkdirSync(CACHE_ROOT, {recursive: true});
  fs.rmSync(JNI_ROOT, {recursive: true, force: true});
  fs.rmSync(ASSET_ROOT, {recursive: true, force: true});
  for (const [abi, config] of Object.entries(PACKAGES)) await buildAbi(abi, config);
  await buildDefinitions();
  return {jniRoot: JNI_ROOT, assetRoot: ASSET_ROOT, cacheRoot: CACHE_ROOT};
}

if (require.main === module) {
  build().then(result => {
    console.log(`Runtime antivirus Android prêt : ${result.jniRoot}`);
    console.log(`Cache vérifié : ${result.cacheRoot}`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  COMMON, DEFINITIONS, ELF_REPLACEMENTS, PACKAGES, TARGETS, build, patchElf, sha256,
};
