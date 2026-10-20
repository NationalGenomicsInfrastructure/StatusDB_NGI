function(doc) {
    var proj_in_fc = {}
    for (sample in doc["samplesheet_csv"]){
        if ("SampleName" in doc["samplesheet_csv"][sample]) {
            var proj_id = doc["samplesheet_csv"][sample]["SampleName"].split("_")[0]
        } else {
            var proj_id = doc["samplesheet_csv"][sample]["Sample_Name"].split("_")[0]
        }
    // Test if it a valid project ID
        if (/^P\d+$/.test(proj_id)) {
            proj_in_fc[proj_id] = true
        }
    }
    // NovaSeq X Plus has more digits in the date, will mess up the sorting if not adjusted
    name_arr = doc["name"].split("_")
    run_date_original = name_arr[0]
    run_date = run_date_original.slice(-6)
    modified_name = [run_date, name_arr[1]].join('_')
    emit(modified_name, Object.keys(proj_in_fc))
}
