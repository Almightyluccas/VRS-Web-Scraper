import puppeteer, { Page } from "puppeteer";
import { tryCatch } from "../utils/tryCatch";
import configDotenv from "dotenv";
import path from 'path';
import fs from 'fs';

configDotenv.config();
const { VRS_USERNAME, VRS_PASSWORD } = process.env;
const DOWNLOAD_PATH = path.join(process.cwd(), 'downloads');
const VRS_URL = "https://virtualracingschool.appspot.com";
const DATA_PACKS_URL = `${VRS_URL}/#/DataPacks/B/vrs-free,vrs-premium`;

if (!fs.existsSync(DOWNLOAD_PATH)) fs.mkdirSync(DOWNLOAD_PATH, { recursive: true });

type DataItem = {
  rowData: string[];
  files: {
    name: string;
    url: string;
    path: string;
  }[]
};

const getPageInfo = async (page: Page) => page.evaluate(() => {
  const selBase = "#gwt-debug-mainWindow > div > main > div:nth-child(2) > div > div:nth-child(3) > div > div > div > div > div > div:nth-child(1) > div.m8.l9.col > div:nth-child(2) > div.m12.l6.col > div > span";
  const trackNameEl = document.querySelector(`${selBase}:nth-child(5) > span`);
  const carNameEl = document.querySelector(`${selBase}:nth-child(7) > span`);
  const trackName = (trackNameEl?.textContent?.trim() || "unknown-track").replace(/\s+/g, '');
  const carName = (carNameEl?.textContent?.trim() || "unknown-car").replace(/\s+/g, '');
  return { trackName, carName };
});

const clickCardAction = async (page: Page) => {
  const cardSelector = "#gwt-debug-dataAndSocialContainer > div.IRGHJVC-H-j > div:nth-child(2) > div > div.card-action > a";
  await page.waitForSelector(cardSelector, { visible: true }).catch(() => {});

  const { error } = await tryCatch(Promise.all([
    page.waitForNavigation().catch(() => {}),
    page.click(cardSelector)
  ]));

  if (!error) return true;

  const { data: evalResult } = await tryCatch(page.evaluate(sel => {
    const element = document.querySelector(sel);
    if (element) { (element as HTMLElement).click(); return true; }
    return false;
  }, cardSelector));

  return evalResult === true;
};

const vrsLogin = async (page: Page) => {
  if (!VRS_USERNAME || !VRS_PASSWORD) throw new Error("Missing VRS credentials");

  const { error: navError } = await tryCatch(page.goto(`${VRS_URL}/#/Home`));
  if (navError) throw new Error("Failed to navigate to login page");

  if (!await clickCardAction(page)) throw new Error("Failed to click login card");

  const loginPromise = (async () => {
    await page.waitForSelector("#email", { visible: true });
    await page.type("#email", VRS_USERNAME);
    await page.type("#password", VRS_PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }),
      page.click("#submitButton")
    ]);
  })();

  const { error } = await tryCatch(loginPromise);
  if (error) throw new Error(`Login failed: ${(error as Error).message}`) ;
  console.log("Login complete");
};

const renameDownloadedFile = async (originalPath: string, newPath: string) => {
  try {
    fs.renameSync(originalPath, newPath);
    return true;
  } catch (error) {
    console.error(`Error renaming file: ${(error as Error).message}`);
    return false;
  }
};

const scrapeFiles = async (page: Page, processedFiles = new Set<string>()): Promise<DataItem['files']> => {
  const scrapeFilesPromise = (async () => {
    await page.waitForSelector('a.gwt-Anchor[data-tooltip$=".sto"]', { timeout: 3000 });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const pageInfo = await getPageInfo(page);
    const stoFiles = await page.$$eval('a.gwt-Anchor[data-tooltip$=".sto"]',
      links => links.map(link => ({
        tooltip: link.getAttribute('data-tooltip') || '',
        text: link.textContent?.trim() || '',
      }))
    );

    const carFolderPath = path.join(DOWNLOAD_PATH, pageInfo.carName);
    if (!fs.existsSync(carFolderPath)) {
      fs.mkdirSync(carFolderPath, { recursive: true });
    }

    const downloadedFiles: DataItem['files'] = [];
    const date = new Date().toISOString().split('T')[0];
    let newFilesCount = 0;

    for (let i = 0; i < stoFiles.length; i++) {
      const fileInfo = stoFiles[i];
      const originalFileName = fileInfo.text || path.basename(fileInfo.tooltip);
      const fileBaseName = originalFileName.replace(/\.sto$/i, '');

      const formattedFileName = `(${pageInfo.carName}_${pageInfo.trackName})${originalFileName}`;
      const uniqueFileId = `${fileInfo.tooltip}-${originalFileName}`;
      const newPath = path.join(carFolderPath, originalFileName);

      if (processedFiles.has(uniqueFileId) && fs.existsSync(newPath)) continue;
      if (i > 0) await new Promise(resolve => setTimeout(resolve, 1000));

      const { data: linkExists } = await tryCatch(page.evaluate(tooltip => {
        const link = document.querySelector(`a.gwt-Anchor[data-tooltip="${tooltip}"]`);
        if (link) { (link as HTMLElement).click(); return true; }
        return false;
      }, fileInfo.tooltip));

      if (linkExists) {
        const okButtonSelector = 'a.default-button.text-button[data-vrs-widget-field="defaultButton"]';

        const okButtonExists = await page.$(okButtonSelector).then(button => !!button);
        if (okButtonExists) await page.click(okButtonSelector);
        const originalPath = path.join(DOWNLOAD_PATH, originalFileName);

        let renamed = false;
        if (fs.existsSync(originalPath)) {
          renamed = await renameDownloadedFile(originalPath, newPath);
        } else {
          try {
            const recentFiles = fs.readdirSync(DOWNLOAD_PATH)
              .filter(f => f.endsWith('.sto') &&
                fs.statSync(path.join(DOWNLOAD_PATH, f)).mtime > new Date(Date.now() - 10000));

            if (recentFiles.length > 0) {
              renamed = await renameDownloadedFile(path.join(DOWNLOAD_PATH, recentFiles[0]), newPath);
            }
          } catch (err) {
            throw new Error(`Error finding recent files: ${err}`);
          }
        }

        if (renamed) {
          downloadedFiles.push({ name: originalFileName, url: fileInfo.tooltip, path: newPath });
          processedFiles.add(uniqueFileId);
          newFilesCount++;
        }
      }
    }

    if (newFilesCount > 0) console.log(`Downloaded ${newFilesCount} new files out of ${stoFiles.length} total`);
    return downloadedFiles;
  })();

  const { data, error } = await tryCatch(scrapeFilesPromise);
  if (error) console.error('Error in scrapeFiles:', (error as Error).message);
  return data as DataItem['files'] || [];
};

const clickExpandButton = async (page: Page) => {
  try {
    await new Promise(resolve => setTimeout(resolve, 1000));

    const selector = "#gwt-debug-dataPackDetailsView > div:nth-child(4) > div > table > tbody > tr:nth-child(1) > td > a";

    await page.waitForSelector(selector, {
      visible: true,
      timeout: 5000
    }).catch(() => console.log("Expand button selector not found"));

    const elementExists = await page.evaluate((sel) => {
      const element = document.querySelector(sel);
      if (element) {
        (element as HTMLElement).click();
        return true;
      }
      return false;
    }, selector);

    if (elementExists) {
      console.log("Clicked expand button successfully");
      await new Promise(resolve => setTimeout(resolve, 1500));
    } else {
      console.log("Expand button not found or not clickable");
    }
  } catch (e) {
    console.log(`Error clicking expand button: ${e}`);
  }
}
const scrapeRow = async (page: Page, rowIndex: number, totalRows: number, processedFiles: Set<string>): Promise<DataItem> => {
  const rowPromise = (async () => {
    console.log(`------ Processing row ${rowIndex}/${totalRows} ------`);

    if (!page.url().includes('DataPacks')) {
      await page.goto(DATA_PACKS_URL);
    }

    await page.waitForSelector('table tbody tr', { visible: true });
    const buttonSelector = `table tbody tr:nth-child(${rowIndex}) td.view-details-column a.primary-button`;
    if (!await page.$(buttonSelector)) return { rowData: [], files: [] };

    const rowData = await page.evaluate(sel => {
      const row = document.querySelector(sel);
      if (!row) return [];
      return Array.from(row.querySelectorAll('td')).map(cell => cell.textContent?.trim() || '');
    }, `table tbody tr:nth-child(${rowIndex})`);

    await Promise.all([
      page.waitForNavigation().catch(() => {}),
      page.evaluate(sel => {
        const button = document.querySelector(sel);
        if (button) (button as HTMLElement).click();
      }, buttonSelector)
    ]);

    if (!await page.evaluate(() => !!document.querySelector('#gwt-debug-dataPackDetailsView'))) {
      return { rowData, files: [] };
    }

    await page.waitForFunction(() =>
        Array.from(document.querySelectorAll('td.view-details-column > a')).length > 0
    ).catch(() => {});

    let files: DataItem['files'] = [];

    await clickExpandButton(page);
    const buttonCount = await page.evaluate(() =>
      document.querySelectorAll('td.view-details-column > a').length
    );

    for (let i = 0; i < buttonCount; i++) {
      if (i >= 8) continue;
      if (i != 0) {
        try {
          await page.waitForSelector("#gwt-debug-dataPackDetailsView > div:nth-child(4) > div > table > tbody > tr:nth-child(1) > td > a");
          await clickExpandButton(page);
        } catch (expandError) {
          console.log(`Error clicking expand button: ${expandError}`);
        }
      }

      console.log(`Processing button ${i+1}/${buttonCount}`);

      try {
        const buttonSelector = `#gwt-debug-dataPackDetailsView > div:nth-child(4) > div > table > tbody > tr:nth-child(${i+1}) > td.view-details-column > a`;
        await page.waitForSelector(buttonSelector);

        await Promise.all([
          page.waitForNavigation().catch(() => {}),
          page.click(buttonSelector)
        ]);

        const hasFiles = await page.evaluate(() =>
          !!document.querySelector('.card-content') ||
          !!document.querySelector('.vrs-list-view') ||
          !!document.querySelector('.session-file')
        );

        if (!hasFiles) {
          console.log('No files found, going back');
          await page.goBack();
          await page.waitForNetworkIdle().catch(() => {});
          continue;
        }

        console.log('Files found, scraping...');
        const newFiles = await scrapeFiles(page, processedFiles);
        files.push(...newFiles);

        await page.goBack();
        await page.waitForSelector(buttonSelector, { timeout: 5000 });

      } catch (e) {
        console.log(`Error processing button ${i+1}: ${e}`);
        await page.goto(DATA_PACKS_URL).catch(() => {});
      }
    }


    await page.goto(DATA_PACKS_URL, { waitUntil: 'networkidle0' }).catch(() => {});
    return { rowData, files };
  })();

  const { data, error } = await tryCatch(rowPromise);
  if (error) await tryCatch(page.goto(DATA_PACKS_URL));
  return data as DataItem || { rowData: [], files: [] };
};

const scrapeTable = async (page: Page, processedFiles: Set<string>) => {
  const tablePromise = (async () => {
    await page.goto(DATA_PACKS_URL, { waitUntil: 'networkidle0' });
    await page.waitForSelector('table tbody tr', { visible: true });

    const rowCount = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
    console.log(`Found ${rowCount} rows to process`);
    const results: DataItem[] = [];

    for (let i = 60; i <= rowCount; i++) {
      for (let retry = 0; retry < 2; retry++) {
        const { data: rowData, error: rowError } = await tryCatch(scrapeRow(page, i, rowCount, processedFiles));

        if (!rowError && rowData && (rowData.rowData.length > 0 || rowData.files.length > 0)) {
          results.push(rowData);
          break;
        } else if (retry < 1) {
          await tryCatch(page.goto(DATA_PACKS_URL));
        }
      }
    }

    return {data: `completed processing all ${results.length} rows`};
  })();

  const { data, error } = await tryCatch(tablePromise);
  return error ? { error: `Error in scrapeTable ${error}` } : { data };
};

export const vrsScraper = async () => {
  const processedFiles = new Set<string>();
  const { data: browser, error: browserError } = await tryCatch(puppeteer.launch({
    headless: false, defaultViewport: null,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
    waitForInitialPage: true,
  }));

  if (browserError) throw new Error(`Browser Launch Error: ${browserError}`);

  const { data: page, error: pageError } = await tryCatch(browser.newPage());
  if (pageError) throw new Error(`Page Creation Error: ${pageError}`);

  const { data: client, error: clientError } = await tryCatch(page.createCDPSession());
  if (clientError) throw new Error(`CDP Session Error: ${clientError}`);

  const { error: downloadError } = await tryCatch(client.send("Page.setDownloadBehavior", {
    behavior: "allow", downloadPath: DOWNLOAD_PATH,
  }));
  if (downloadError) throw new Error(`Download Error: ${downloadError}`);

  const { error: loginError } = await tryCatch(vrsLogin(page));
  if (loginError) throw new Error(`Login Error: ${loginError}`);

  const { data: scrapingStatus, error: tableError } = await tryCatch(scrapeTable(page, processedFiles));
  if (tableError) throw new Error(`Table Error: ${tableError}`);

  await browser.close();
  return { success: true, data: scrapingStatus };



};