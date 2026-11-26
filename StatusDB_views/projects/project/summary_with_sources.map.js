/*
Used by genomics-status at:
 /api/v1/projects,
 /api/v1/project_fields,
 /api/v1/project_summary/:id
*/

// Used for the project cards at http://genomics-status.scilifelab.se/project_cards

var inc = function(prop, def) {
  if (prop == undefined) {
    prop = def;
  }
  else {
    prop += def;
  }
  return prop;
}

var key_count = function(obj) {
  var n_keys = 0;
  for (key in obj) {
    n_keys++;
  }
  return n_keys
}

function(doc) {
  var summary = Object();
  summary["field_sources"] = Object();

  // final_number_of_samples emitted only if 'status_(manual)' is set for all
  var final_number_of_samples = 0;
  var aborted_samples = 0;
  var is_final = true;
  if (doc["samples"] == undefined) {is_final = false;}

  // Temporary objects for counting purposes
  var lib_repreps = Object();
  var pools = Object();
  var lanes = Object();
  var progress = Object(); // possible keys: "Aborted", "In Progress", "Finished"

  summary["passed_samples"]=0;
  summary["field_sources"]["passed_samples"] = "Samples with seq_qc_flag == 'PASSED' from LIMS, calculated on StatusDB view project/summary.map.js"


  for (sample in doc["samples"]) {
    var seen=false;
    //Sequencing QC
    if (doc["samples"][sample].hasOwnProperty('library_prep')){
      var latest_seq="0";
      for(lib in doc["samples"][sample]['library_prep']){
        if (doc["samples"][sample]['library_prep'][lib].hasOwnProperty('sample_run_metrics')){
          for(runid in doc["samples"][sample]['library_prep'][lib]['sample_run_metrics']){
            if (doc["samples"][sample]['library_prep'][lib]['sample_run_metrics'][runid]["sequencing_start_date"]> latest_seq){
              latest_seq=doc["samples"][sample]['library_prep'][lib]['sample_run_metrics'][runid]["sequencing_start_date"];
              if (doc["samples"][sample]['library_prep'][lib]['sample_run_metrics'][runid]['seq_qc_flag'] == "PASSED" && !seen){
                summary["passed_samples"]=inc(summary["passed_samples"], 1);
                seen=true;
              }
            }
          }
        }
      }
    }


    // samples > [sample] > details
    if ("details" in doc["samples"][sample]){

      // final_number_of_samples
      var status = doc["samples"][sample]["details"]["status_(manual)"];
      if (status !== "Aborted"){
        final_number_of_samples += 1;
      } else {
        aborted_samples = inc(aborted_samples,1);
      }
      if (status !== undefined){
        summary[status] = inc(summary[status],1)
        summary["field_sources"][status] = "Samples with status_(manual) == '"+status+"' from LIMS project summary, calculated on StatusDB view project/summary.map.js"
      }
      else {
        is_final = false;
      }

      // passed_initial_qc
      var initial_qc = doc["samples"][sample]["details"]["passed_initial_qc"];
      if (initial_qc == "True") {
        progress["passed_initial_qc"] = inc(progress["passed_initial_qc"], 1);
      }
      else if (initial_qc == "False") {
        progress["passed_initial_qc"] = inc(progress["passed_initial_qc"], 0);
      }

      // samples > [sample] > library_prep
      var lib_qc = undefined;
      for (prep in doc["samples"][sample]["library_prep"]) {
        if (prep !== 'A') {
          lib_repreps[prep] = 1;
        }
        // [library_prep] > sample_run_metrics
        for (lane in doc["samples"][sample]["library_prep"][prep]["sample_run_metrics"]) {
          lanes[lane.split("_").slice(0,3).join("_")] = 1;
        }

        prep_status = doc["samples"][sample]["library_prep"][prep]["prep_status"];
        if (prep_status == "PASSED") {
          lib_qc = inc(lib_qc,1);
        }
        else if (prep_status == "FAILED") {
          lib_qc = inc(lib_qc,0);
        }
      }

      // Library QC
      if (lib_qc !== undefined) {
        progress["passed_library_qc"] = inc(progress["passed_library_qc"], Math.min(1,lib_qc));
      }

      // number_of_pools
      if (doc["samples"][sample]["details"]["pooling"] !== undefined) {
        pools[doc["samples"][sample]["details"]["pooling"]] = 1;
      }
    }
  } // End of sample loop


  summary["field_sources"]["passed_library_qc"] = "Samples with at least one library preparation with prep_status PASSED in LIMS. If 'NA', either no library prep has prep_status set, or 'status_(manual)' is missing for some sample. Calculated on StatusDB view project/summary.map.js"
  summary["field_sources"]["passed_initial_qc"] = "Samples with passed_initial_qc == 'True' from LIMS. If 'NA', either no initial qc is registered, or 'status_(manual) is missing for some sample. Calculated on StatusDB view project/summary.map.js"
  summary["field_sources"]["passed_seq_qc"] = "Samples with at least one seq_qc_flag == 'PASSED' from LIMS. If 'NA', either no sample has seq_qc_flag set, or 'status_(manual) is missing for some sample. Calculated on StatusDB view project/summary.map.js"
  summary["passed_library_qc"] = 'NA'
  summary["passed_initial_qc"] = 'NA'
  summary["passed_seq_qc"] = 'NA'
  // X/Y passed QC
  if (is_final) {
    if (progress["passed_library_qc"] !== undefined) {
      summary["passed_library_qc"] = String(progress["passed_library_qc"]) ;
    }
    if (progress["passed_initial_qc"] !== undefined) {
      summary["passed_initial_qc"] = String(progress["passed_initial_qc"]);
    }
    if (summary["passed_samples"] !== undefined) {
      summary["passed_seq_qc"] = String(summary["passed_samples"]);
    }
  }

  // Count objects, emit only if count !== 0
  summary["library_repreps"] = key_count(lib_repreps) || undefined;
  summary["number_of_pools"] = key_count(pools) || undefined;
  summary["lanes_sequenced"] = key_count(lanes) || undefined;

  /* Details will contain all project level udfs */
  summary["details"] = doc["details"];
  /* Project summary will contain all temporary process/project level udfs */
  summary["project_summary"] = doc["project_summary"];
  summary["application"] = doc["application"];
  summary["no_samples"] = doc["no_of_samples"];
  summary["field_sources"]["no_samples"] = "Total number of samples in LIMS, calculated on LIMS2DB"
  summary["ordered_reads"] = doc["min_m_reads_per_sample_ordered"];
  summary["field_sources"]["ordered_reads"] = "Minimum number of reads per sample ordered (probably from LIMS)"
  summary["open_date"] = doc["open_date"];
  summary["project_name"] = doc["project_name"];
  summary["affiliation"] = doc["affiliation"];
  summary["order_details"] = doc["order_details"];
  summary["delivery_projects"] = doc["delivery_projects"];
  summary["modification_time"] = doc["modification_time"];
  summary["priority"] =  doc["priority"];
  //Check for PI contact information
  if ("contact" in doc) {
    summary["contact"] = doc["contact"];
  }

  if ("source" in doc) {
    summary["source"] = doc["source"];
  }
  else {
    summary["source"] = "gdocs";
  }

  summary["field_sources"]["final_number_of_samples"] = "Number of samples in LIMS project summary that are not aborted.  If 'NA', some sample is missing 'status_(manual)' in project summary. Calculated on StatusDB view project/summary.map.js"
  summary['final_number_of_samples'] = 'NA';
  if (is_final) {
    summary["final_number_of_samples"] = final_number_of_samples;
  }
  summary["field_sources"]["aborted_samples"] = "Number of samples in LIMS project summary that are aborted. If 'NA', some sample is missing 'status_(manual)' in project summary. Calculated on StatusDB view project/summary.map.js"
  summary['aborted_samples'] = 'NA';
  summary["aborted_samples"] = aborted_samples;

  summary["reference_genome"] = doc["reference_genome"]
  summary["customer_reference"] = doc["customer_reference"]
  if ("uppnex_id" in doc){
    summary["delivery_type"] = doc["uppnex_id"]
  }
  else if("delivery_type" in doc) {
    summary["delivery_type"] = doc["delivery_type"]
  }
  summary["uppnex_id"] = doc["uppnex_id"]
  summary["close_date"] = doc["close_date"]

  if (doc.hasOwnProperty("escalations") && doc.escalations.length >0){
    summary["pending_reviews"]=doc.escalations;
  }
  if(doc.hasOwnProperty("invoice_spec_downloaded")){
    summary["invoice_spec_downloaded"] = doc["invoice_spec_downloaded"];
  }

  summary["status"] = doc["status_fields"]["status"];
  if (doc.hasOwnProperty("samples_with_errors")){
    summary["samples_with_errors"] = doc["samples_with_errors"];
  }

  if ((summary["source"] == "lims") && (!("close_date" in doc))){
    emit(["open", doc["project_id"]], summary);
  } else {
    emit(["closed", doc["project_id"]], summary);
  }
}
