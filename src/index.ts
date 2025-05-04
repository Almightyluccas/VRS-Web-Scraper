import { vrsScraper } from './bots/vrs-scraper';
import {tryCatch} from "./utils/tryCatch";


const main = async () => {
  const {data: vrsData, error: vrsError} = await tryCatch(vrsScraper());
  if (vrsError) return {vrsError: vrsError};

  return {success: true};
}

main()
  .then((result) => {
    console.log("Result: ", result);
  })
  .catch((error) => {
    console.error(error);
  });