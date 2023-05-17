import {firestore, storage} from "firebase-admin";
import PDFDocument from "pdfkit-table";
// import {isEmpty} from "lodash";
import {SensorData} from "../sensor-data-functions/sensor";
import {getAllDatesThatNeedsReportToGenerate} from "../util/pdfUtiliy";

// interface ReportsFields {
//     lastFileUploaded: string
// }

interface SensorCollectionAndLabel {
    collection: string,
    label: string,
}

const sensorCollctionNames: SensorCollectionAndLabel[] = [
  {collection: "temperature", label: "Temperature"},
  {collection: "ec_level", label: "EC Level"},
  {collection: "humidity", label: "Humidity"},
  {collection: "light_resistance", label: "Light Resistance"},
  {collection: "ph_level", label: "PH Level"},
  {collection: "water_level", label: "Water Level"},
];

/**
 * @param {firestore.Firestore} firestore
 * @param {storage.Storage} storage
 */
export async function generateReportsV2(firestore: firestore.Firestore, storage: storage.Storage) {
  await generateDailyReports(firestore, storage);
}

/**
 * @param {firestore.Firestore} firestore
 * @param {storage.Storage} storage
 */
async function generateDailyReports(firestore: firestore.Firestore, storage: storage.Storage) {
  const dates = await getAllDatesThatNeedsReportToGenerate(firestore, "daily");
  for (let i = 0; i < dates.length; i++) {
    const sensorData = await getSensorData(firestore, new Date(dates[i]));
    if (sensorData.length != 0) {
      for (let a = 0; a < sensorData.length; a++) {
        const sensor = sensorData[a];
        const tableData = sensor.sortedData.map((data, index) => {
          const temp = sensor.data[index];
          return {column1: data, column2: `${temp.convertedDatetime} ${temp.value}`};
        });
        const fileRef = generateFileReference(storage, sensor.collection, dates[i]);
        const doc = new PDFDocument();
        const writeStream = fileRef.createWriteStream({
          resumable: false,
          contentType: "application/pdf",
        });
        doc.pipe(writeStream);
        doc.image(`${__dirname}/../resources/aqua.png`, 120, 20, {width: 75});
        doc.fontSize(10);
        doc.font("Helvetica").text("AQUA - A Cross-platform Application for Hydroponics Monitoring System", 200, 55, {align: "center", width: 200});
        doc.image(`${__dirname}/../resources/sblogo.png`, 405, 26, {width: 75});
        doc.font("Helvetica").text(`SYSTEM REPORT FOR USER LOGS ${sensor.label}`, 200, 100, {align: "center", width: 200});
        doc.rect(72, 120, 468, 20);
        doc.fill("#74FF99");
        doc.rect(72, 140, 468, 20);
        doc.fill("#0B0E98");
        doc.fill("#000");
        doc.font("Helvetica").text("Daily Reports", 90, 125, {align: "center", width: 200});
        doc.font("Helvetica").text("Daily Reports", 320, 125, {align: "center", width: 200});
        doc.fill("#FFFFFF");
        doc.font("Helvetica").text(`${sensor.label}`, 90, 145, {align: "center", width: 200});
        doc.font("Helvetica").text(`${sensor.label}`, 320, 145, {align: "center", width: 200});
        await doc.table({
          headers: [
            {label: "Higest | Lowest", property: "column1", align: "center", headerColor: "#74FF99", headerOpacity: 1},
            {label: "Date | Value", property: "column2", align: "center", headerColor: "#74FF99", headerOpacity: 1},
          ],
          datas: tableData as unknown as {[key:string]: string}[],
        }, {x: 72, y: 164});
        doc.end();
      }
    }
  }
  const fileDate = dates[dates.length - 1];
  firestore.collection("reports").doc("daily").update({lastFileUploaded: `${fileDate.getFullYear()}-${fileDate.getMonth() + 1}-${fileDate.getDate()}`});
}

/**
 * @param {firestore.Firestore} firestore
 * @param {string} collectionName
 * @param {Date} date
 */
async function getSensorDataAsPerDate(firestore: firestore.Firestore, collectionName: string, date: Date) {
  return (await firestore.collection(collectionName)
    .where("datetime", ">=", new Date(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} 00:00:00`))
    .where("datetime", "<=", new Date(`${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()} 23:59:59`))
    .orderBy("datetime", "desc").get()).docs.map((value) => value.data() as SensorData);
}

/**
 * @param {firestore.Firestore} firestore
 * @param {Date} date
 */
async function getSensorData(firestore: firestore.Firestore, date: Date) {
  const sensorData = [];
  for (let i = 0; i < sensorCollctionNames.length; i++) {
    const sensor = sensorCollctionNames[i];
    const data = await getSensorDataAsPerDate(firestore, sensor.collection, date);
    if (data.length != 0) {
      const withConvertedDateTime = data.map((res) => ({
        ...res,
        convertedDatetime: toDateTime(res.datetime["_seconds"]),
      }));
      const sortedData = withConvertedDateTime.map((sensor) => Number(sensor.value)).sort((a, b) => {
        if (a > b) return -1;
        if (a < b) return 1;
        return 0;
      });
      sensorData.push({...sensor, data: withConvertedDateTime, sortedData});
    }
  }
  return sensorData;
}

/**
 * @param {number} secs
 * @return {Date}
 */
function toDateTime(secs: number): string {
  const t = new Date(1970, 0, 1); // Epoch
  t.setSeconds(secs);
  return `${t.getFullYear()}-${t.getMonth() + 1}-${t.getDate()} ${t.getHours()}:${t.getMinutes()}:${t.getSeconds()}`;
}

/**
 * @param {storage.Storage} storage
 * @param {string} sensor
 * @param {Date} value
 * @return {File}
 */
function generateFileReference(storage: storage.Storage, sensor: string, value: Date) {
  const folder = `daily-reports/${sensor}/`;
  const fileName = `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
  return storage.bucket().file(folder + fileName + ".pdf");
}
