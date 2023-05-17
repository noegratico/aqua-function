/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {DataSnapshot} from "firebase-admin/database";
import {Change, EventContext, logger} from "firebase-functions/v1";
import {firestore, storage} from "firebase-admin";
import {FieldValue, WriteResult} from "firebase-admin/firestore";
import {isEmpty, startCase} from "lodash";
import PDFDocument from "pdfkit-table";
import {createTabularReport} from "../util/pdfUtiliy";

export interface SensorData {
  value: string,
  datetime: {[key: string]: number}
  convertedDatetime?: string
}

export interface SchedulerParameter {
  docName: string,
  data: {[key: string]: any}
}

export type Table = any;

interface ReportsFields {
  lastFileUploaded: string
}

export interface SensorParameter {
  collectionName: string
  pageIndex?: number,
  limit?: number
}

/**
 * Add data to firestore
 * @param {firestore.Firestore} firestore - firestore instance
 * @param {Change<DataSnapshot>} snap - changed value
 * @param {EventContext} context - event context
 * @return {PromiseLike}
 */
export function addSensorDataToDatabase(firestore: firestore.Firestore, snap: Change<DataSnapshot>, context: EventContext): PromiseLike<WriteResult> {
  const key = snap.after.key != null ? snap.after.key : "";
  return firestore.collection("sesors").doc(key).set({
    value: snap.after.val(),
    timestamp: FieldValue.serverTimestamp(),
    eventType: context.eventType,
  });
}

/**
 * @param {firestore.Firestore} firestore
 */
export async function getSensorRecentData(firestore: firestore.Firestore) {
  return {
    ecLevel: await findRecentSensorData(firestore, "ec_level"),
    humidity: await findRecentSensorData(firestore, "humidity"),
    lightResistance: await findRecentSensorData(firestore, "light_resistance"),
    phLevel: await findRecentSensorData(firestore, "ph_level"),
    snapA: await findRecentSensorData(firestore, "snap_a"),
    snapB: await findRecentSensorData(firestore, "snap_b"),
    temperature: await findRecentSensorData(firestore, "temperature"),
    waterLevel: await findRecentSensorData(firestore, "water_level"),
  };
}

/**
 * @param {firestore.Firestore} firestore
 * @param {SensorParameter} data
 */
export async function getSensorHistoricalData(firestore: firestore.Firestore, data: SensorParameter) {
  const pageIndex = data.pageIndex ? data.pageIndex : 0;
  const limit = data.limit ? data.limit : 10;
  const ref = getSortedSensorData(firestore, data.collectionName);
  const count = (await ref.count().get()).data().count;
  const temp = (await ref.get()).docs[pageIndex * limit];
  const result = (await ref.startAt(temp).limit(limit).get()).docs.map((element) => mapDataToSensorData(element.data()));
  return {
    data: result,
    count,
  };
}

/**
 * @param {firestore.Firestore} firestore
 * @param {storage.Storage} storage
 */
export async function generateReports(firestore: firestore.Firestore, storage: storage.Storage) {
  // generate daily
  await generateDaily(firestore, storage);
  const fileDate = await generateAllSensorsReportDaily(firestore, storage);
  firestore.collection("reports").doc("daily").update({lastFileUploaded: `${fileDate.getFullYear()}-${fileDate.getMonth() + 1}-${fileDate.getDate()}`});
}

/**
 * @param {firestore.Firestore} firestore
 * @param {storage.Storage} storage
 */
async function generateDaily(firestore: firestore.Firestore, storage: storage.Storage) {
  logger.info("start report generation");
  const lastFileUploaded = ((await firestore.collection("reports").doc("daily").get()).data() as ReportsFields).lastFileUploaded;
  const startDate = (isEmpty(lastFileUploaded) ? getYesterdayDate() : getTommorrowDate(lastFileUploaded));
  const endDate = new Date();
  const dates: Date[] = [];

  while (startDate <= endDate) {
    dates.push(new Date(startDate));
    startDate.setDate(startDate.getDate() + 1);
  }
  logger.info("dates", dates);
  await Promise.allSettled(dates.map(async (value) => {
    // get data from firestore
    const data = new Map<string, any>();
    for (const sensor of ["temperature", "ec_level", "humidity", "light_resistance", "ph_level", "water_level", "snap_a", "snap_b"]) {
      const result = (await getSensorDataAsPerDate(firestore, sensor, value)).map((res) => ({
        ...res,
        convertedDatetime: toDateTime(res.datetime["_seconds"]),
      }));
      if (result.length !== 0) {
        data.set(sensor, result);
      }
    }
    if (data.size !== 0) {
      // generate daily report
      for (const sensor of ["temperature", "ec_level", "humidity", "light_resistance", "ph_level", "water_level", "snap_a", "snap_b"]) {
        const sensorData = data.has(sensor) ? data.get(sensor) : [];
        if (sensorData.length === 0) {
          continue;
        }
        const folder = `daily-reports/${sensor}/`;
        const fileName = `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
        const fileRef = storage.bucket().file(folder + fileName + ".pdf");
        const doc = new PDFDocument();
        const writeStream = fileRef.createWriteStream({
          resumable: false,
          contentType: "application/pdf",
        });
        logger.info(`start generating report for ${fileName}`);
        doc.pipe(writeStream);
        const name = startCase(sensor).replace("_", " ");
        await doc.table(createTabularReport(sensorData, name, `Records of ${name} for the day of ${fileName}`));
        doc.end();
      }
    }
  }));
}

/**
 * @param {firestore.Firestore} firestore
 * @param {storage.Storage} storage
 */
async function generateAllSensorsReportDaily(firestore: firestore.Firestore, storage: storage.Storage) {
  logger.info("start report generation");
  const lastFileUploaded = ((await firestore.collection("reports").doc("daily").get()).data() as ReportsFields).lastFileUploaded;
  const startDate = (isEmpty(lastFileUploaded) ? getYesterdayDate() : getTommorrowDate(lastFileUploaded));
  const endDate = new Date();
  const dates: Date[] = [];

  while (startDate <= endDate) {
    dates.push(new Date(startDate));
    startDate.setDate(startDate.getDate() + 1);
  }
  logger.info("dates", dates);
  await Promise.allSettled(dates.map(async (value) => {
    // get data from firestore
    const data = new Map<string, any>();
    for (const sensor of ["temperature", "ec_level", "humidity", "light_resistance", "ph_level", "water_level", "snap_a", "snap_b"]) {
      const result = (await getSensorDataAsPerDate(firestore, sensor, value)).map((res) => ({
        ...res,
        convertedDatetime: toDateTime(res.datetime["_seconds"]),
      }));
      if (result.length !== 0) {
        data.set(sensor, result);
      }
    }
    if (data.size !== 0) {
      // generate daily report
      const folder = "daily-reports/";
      const fileName = `${value.getFullYear()}-${value.getMonth() + 1}-${value.getDate()}`;
      const fileRef = storage.bucket().file(folder + fileName + ".pdf");
      const doc = new PDFDocument();
      const writeStream = fileRef.createWriteStream({
        resumable: false,
        contentType: "application/pdf",
      });
      logger.info(`start generating report for ${fileName}`);
      doc.pipe(writeStream);
      for (const sensor of ["temperature", "ec_level", "humidity", "light_resistance", "ph_level", "water_level", "snap_a", "snap_b"]) {
        const name = startCase(sensor).replace("_", " ");
        const value = data.has(sensor) ? data.get(sensor) : [];
        await doc.table(createTabularReport(value, name, `Records of ${name} for the day of ${fileName}`));
      }
      doc.end();
    }
  }));
  return dates[dates.length - 1];
}

/**
 * @param {firestore.Firestore} firestore
 * @param {string} collectionName
 * @return {firestore.Query<firestore.DocumentData>}
 */
function getSortedSensorData(firestore: firestore.Firestore, collectionName: string): firestore.Query<firestore.DocumentData> {
  return firestore.collection(collectionName).orderBy("datetime", "desc");
}

/**
 * @param {firestore.Firestore} firestore
 * @param {string} collectionName
 * @return {Promise<SensorData | undefined>}
 */
async function findRecentSensorData(firestore: firestore.Firestore, collectionName: string): Promise<SensorData | undefined> {
  return mapDataToSensorData((await getSortedSensorData(firestore, collectionName).get()).docs.find(isNotNull)?.data());
}

/**
 * @param {firestore.QueryDocumentSnapshot<firestore.DocumentData>} element
 * @return {boolean}
 */
function isNotNull(element: firestore.QueryDocumentSnapshot<firestore.DocumentData>): boolean {
  return element.data() != null;
}

/**
 * @param {firestore.DocumentData} data
 * @return {SensorData | undefined}
 */
function mapDataToSensorData(data: firestore.DocumentData | undefined): SensorData | undefined {
  return data && {
    value: data.value,
    datetime: data.datetime,
  };
}
/**
 * @return {Date}
 */
function getYesterdayDate(): Date {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday;
}

/**
 * @param {string} date
 * @return {Date}
 */
function getTommorrowDate(date: string): Date {
  const tommorrow = new Date(date);
  tommorrow.setDate(tommorrow.getDate() + 1);
  return tommorrow;
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
 * @param {SchedulerParameter} data
 * @return {SchedulerParameter}
 */
export function updateScheduler(firestore: firestore.Firestore, data: SchedulerParameter) {
  return firestore.collection("scheduler").doc(data.docName).update({...data.data});
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
