import { vrsScraper } from './bots/vrs-scraper';
//import { uploadToGarage61 } from './bots/garage61-scraper';
import {tryCatch} from "./utils/tryCatch";


const main = async () => {
  const {data: vrsData, error: vrsError} = await tryCatch(vrsScraper());
  if (vrsError) return {vrsError: vrsError};

  // const {data: data, error: garage61Error} = await tryCatch(uploadToGarage61());
  // if(garage61Error) return {garage61Error: "Unable to upload to Garage61"};

  return {success: true};
}

main()
  .then((result) => {
    console.log("Result: ", result);
  })
  .catch((error) => {
    console.error(error);
  });