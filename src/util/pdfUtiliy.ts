import {firestore} from "firebase-admin";
import {SensorData, Table} from "../sensor-data-functions/sensor";
import {isEmpty} from "lodash";


interface ReportsFields {
  lastFileUploaded: string
}

/**
 * @param {SensorData[]} data
 * @param {string} title
 * @param {string} subtitle
 * @return {Table}
 */
export function createTabularReport(data: SensorData[], title: string, subtitle: string): Table {
  const table = {
    title,
    subtitle,
    headers: [
      {label: "Value", property: "value", width: 60, renderer: null},
      {label: "Datetime", property: "convertedDatetime", width: 150, renderer: null},
    ],
    datas: data,
  };
  return table;
}

/**
 * @param {firestore.Firestore} firestore
 * @param {string} doc
 * @return {Date}
 */
export async function getAllDatesThatNeedsReportToGenerate(firestore: firestore.Firestore, doc: string) {
  const lastFileUploaded = ((await firestore.collection("reports").doc(doc).get()).data() as ReportsFields).lastFileUploaded;
  const startDate = (isEmpty(lastFileUploaded) ? getYesterdayDate() : getTommorrowDate(lastFileUploaded));
  const endDate = new Date();
  const dates: Date[] = [];

  while (startDate < endDate) {
    dates.push(new Date(startDate));
    startDate.setDate(startDate.getDate() + 1);
  }

  return dates;
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
