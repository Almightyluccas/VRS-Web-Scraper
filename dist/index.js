"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const vrs_scraper_1 = require("./bots/vrs-scraper");
const garage61_scraper_1 = require("./bots/garage61-scraper");
const tryCatch_1 = require("./utils/tryCatch");
const main = () => __awaiter(void 0, void 0, void 0, function* () {
    const { data: vrsData, error: vrsError } = yield (0, tryCatch_1.tryCatch)(yield (0, vrs_scraper_1.vrsScraper)());
    if (vrsError) {
        return { vrsError: "Unable to scrape VRS data" };
    }
    const { data: data, error: garage61Error } = yield (0, tryCatch_1.tryCatch)(() => (0, garage61_scraper_1.uploadToGarage61)());
    if (garage61Error) {
        return { garage61Error: "Unable to upload to Garage61" };
    }
    return { success: true, data: data };
});
main()
    .then((result) => {
    console.log("Result: ", result);
})
    .catch((error) => {
    console.error("Error: ", error);
});
