let geocodes; // một mảng toàn cục, đại diện cho các vị trí hiện được nhập vào các trường
let map; //đối tượng bản đồ google maps
let geocoder; //đối tượng mã hóa địa lý bản đồ google
let ws; //websocket hiện tại (kết nối với máy chủ)
let directionsService; //đối tượng dịch vụ chỉ đường của google
let directionsDisplay; //đối tượng hiển thị chỉ đường của google (được sử dụng để hiển thị chỉ đường trên bản đồ)
let smallIncInterval; //khoảng tiến độ giả hiện tại; được sử dụng để hiển thị gia tăng tiến độ nhỏ trên các hoạt động phía máy chủ chưa được cập nhật


/**
 * Lệnh gọi lại cho thành phần Google Maps được gọi là soons khi Tập lệnh Maps sẵn sàng.
 * Lệnh gọi lại này cũng được sử dụng để khởi tạo các trường văn bản vị trí, vì một số trình duyệt có thể lưu trữ các giá trị trường cũ
 * phải được phân tích cú pháp lại khi tải lại; điều này chỉ có thể được thực hiện ngay sau khi bản đồ tải xong.
 */
function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 7
    });

    //Listen for the idle state; this meands the state where the maps component has finished loading all data. Only listen once.
    google.maps.event.addListenerOnce(map, 'idle', () => {
        directionsService = new google.maps.DirectionsService();
        directionsDisplay = new google.maps.DirectionsRenderer();
        directionsDisplay.setOptions({suppressMarkers: true});

        geocodes = Array.apply(null, Array(11)).map(function () {
        });
        geocoder = new google.maps.Geocoder();


        recenterMap();

        const recenterMapDebounced = _.debounce(recenterMap, 1500);
        $(".cityField")
            .blur(event => {
                handleCityEdit(event.target.id, () => recenterMap());
            })
            .keypress(event => {
                if (event.which === 13) {
                    handleCityEdit(event.target.id, () => recenterMap());
                }
            }).each((i, obj) => setTimeout(() => handleCityEdit(obj.id, () => recenterMapDebounced()), 500 * (i + 4)));
    });
}

/**
 * Set up all listeners and initialize some SemanticUI components.
 */
$(document).ready(() => {
    $('#closeFailedModal').click(() => {
        $('#failedModal').modal('hide');
    });

    $('#detailsButton').click(() => {
        $('#details-sidebar').sidebar('toggle');
    });

    $('#details-sidebar').sidebar('setting', 'transition', 'overlay')
        .sidebar('setting', 'dimPage', false);

    $('#loading-ok-button').click(() => $('#progessModal').removeClass('active'));

    $('#details-view-table').hide();

    //Initialize warning popups
    $('#city-11').popup();
    $('#city-12').popup();
    $('#linear-interpolation').popup();

    //Hide bouncing arrow when scrolling
    const sideBarContent = $('#sidebar-content');
    sideBarContent.scroll(() => {
        if (sideBarContent[0].scrollHeight - sideBarContent.scrollTop() === sideBarContent.outerHeight()) {
            $('.arrow').hide(500);
        } else {
            $('.arrow').show(500);
        }
    });


    //On calculation start
    $('#calcButton')
        .click(() => {
            //Ensure location fields are valid
            if (!fieldsValid()) {
                return;
            }

            //Add spinning loading circle to the button
            $('#calcButton').addClass("loading");

            //Close old socket if present
            if (ws != null) ws.close();

            //create new socket
            ws = new WebSocket('ws://' + window.location.host + '/msg');
            //set up global flag
            let firstTimeCalc = true;
            let bounceInterval;

            //On message from server
            ws.onmessage = data => {
                let msg = JSON.parse(data.data);

                //on initial message from server (states that server is ready)
                if (msg.type === "STATUS" && msg.status === "READY") {
                    //collect locations as LatLngs
                    let latlngs = [];
                    geocodes.forEach((val) => {
                        if (val) {
                            latlngs.push(val.result.geometry.location);
                        }
                    });

                    //Create and send request
                    ws.send(JSON.stringify({
                        "locations": latlngs,
                        "energy": {
                            "consumption": $('#consumption-level').val(),
                            "interpolation": $('#linear-interpolation').is(":checked"),
                            "additional": {
                                "threshold": $('#consumption-threshold').val(),
                                "value": $('#consumption-extra').val()
                            },
                            "recuperation": {
                                "threshold": $('#recuperation-threshold').val(),
                                "value": $('#recuperation-extra').val()
                            }
                        }
                    }));
                }
                //on calculation status update
                else if (msg.type === "STATUS" && msg.status === "CALC") {
                    //we only want to do this a single time when the server starts calculating
                    if (firstTimeCalc) {
                        //Modal will be active, no need for the spinning circle anymore
                        $('#calcButton').removeClass("loading");

                        firstTimeCalc = false;

                        //Will be used to store intervals to fake progress on states without server progress messages
                        smallIncInterval = null;

                        //Enable modal overlay
                        $('#progessModal').addClass("active");

                        //Set up the progress bar
                        $('#bar').progress({
                            duration: 20, //20ms for a update animation
                            total: 140, //140 total progress points (20 prior, 100 main calculation, 20 afterwards)
                        }).progress('reset') //reset progress
                            .removeClass('success') //remove css class from any former calculations
                            .removeClass('error');

                        const loadingIcon = $('#loading-icon');
                        loadingIcon
                            .removeClass('check') //revert css classes to 'truck'
                            .removeClass('times')
                            .removeClass('loading-icon-green')
                            .removeClass('loading-icon-red')
                            .addClass('truck');

                        //add simple animation to the truck icon
                        bounceInterval = setInterval(() => {
                            loadingIcon.transition('pulse');
                        }, 500);

                        //Do not show the ok button before finishing task
                        $('#loading-ok-button').transition('hide');

                        //Set up fake progress, since the first STATUS/CALC message is always about querying the Distance Matrix API
                        smallIncInterval = setInterval(() => {
                            const bar = $('#bar');
                            if (bar.progress('get value') > 19) { // stop if value reaches 20
                                clearInterval(smallIncInterval);
                                smallIncInterval = null;
                            }
                            bar.progress('increment', 1); //increment every 200ms
                        }, 200);
                    }

                    //set the servers status text message
                    $('#loading-header').text(msg.message);

                    //if the server sends a progress, stop the fake progress (if present) and render the servers progress value instead
                    if (msg.progress) {
                        if (smallIncInterval) {
                            clearInterval(smallIncInterval);
                            smallIncInterval = null;
                        }
                        $('#bar').progress('set progress', 20 + msg.progress); //using 20 as zero since 20 is reached by the former fake progress
                    }
                }
                //if calculation done and result retrieved
                else if (msg.type === "RESULT") {

                    //Tell the user that we are now querying the maps api for a path in the correct order that will be displayed on the map
                    $('#loading-header').text("Tạo bản đồ tuyến đường ...");

                    //We want to setup a new fake progress, so clear it again just in case
                    if (smallIncInterval) {
                        clearInterval(smallIncInterval);
                    }

                    const bar = $('#bar');
                    //Using 120 as zero( 20 (first fake progress) + 100 (server side progress) )
                    bar.progress('set progress', 120);
                    smallIncInterval = setInterval(() => {
                        if (bar.progress('is complete')) { //if full, stop incrementing
                            clearInterval(smallIncInterval);
                            smallIncInterval = null;
                        }
                        bar.progress('increment', 1); //increment every 100 ms
                    }, 100);

                    //Render results into the sidebar
                    renderResults(msg);

                    //Query the directions api with callback
                    createDirections(msg.path, success => {

                        //clear the fake progress
                        if (smallIncInterval) {
                            clearInterval(smallIncInterval);
                            smallIncInterval = null;
                        }

                        //Show error message on query failure
                        if (!success) {
                            onLoadingError(bounceInterval, "Lỗi khi tải bản đồ!");
                            return;
                        }

                        //make sure the bar is complete and green
                        $('#bar').progress('complete').addClass('success');

                        //stop the icon animation
                        clearInterval(bounceInterval);

                        const loadingIcon = $('#loading-icon');

                        //stop any still ongoing transition and flip out
                        loadingIcon.transition('stop').transition('horizontal flip', 500, () => {
                            //on flip out transition end, change the icon to a green check and flip back in
                            $('#loading-icon > i').removeClass('truck').addClass('check').addClass('loading-icon-green');
                            loadingIcon.transition('horizontal flip');
                        });

                        //Tell the user about the success
                        $('#loading-header').text("Tính toán đã hoàn thành!");

                        //Show the ok button that disables the modal overlay
                        $('#loading-ok-button').transition('fade up', 1500);
                    });

                }
                //On any server side failure, show a error message
                else if (msg.type === 'STATUS' && msg.status === 'ERROR') {
                    onLoadingError(bounceInterval, msg.message);
                }

            };
        });


});


/**
 * Check whether the fields are correctly filled. This includes that
 * - at least two fields must be filled out
 * - no field may be filled if the field before it is not filled, except for the first
 * - energy settings fields must be filled
 *
 * The method also performs some animations to tell the user what is wrong.
 *
 * @returns {boolean} true if the fields are filled correctly; false otherwise
 */
function fieldsValid() {
    let ok = true;
    let count = 0;
    $('.cityField').each((i, o) => {
        if ($(o).val() && !(i === 0 || $('#city-' + (i - 1)).val())) {
            $('#city-' + (i - 1)).transition('shake');
            ok = false;
        }
        if ($(o).val()) {
            count++;
        }
    });
    $('.energy-field').each((i, o) => {
        if ($(o).val() === '' || $(o).val() < 0) {
            $(o).transition('pulse');
            ok = false;
        }
    });
    if (ok && count < 2) {
        $('.cityField').transition({
            animation: 'pulse',
            interval: 50
        });
    }
    return ok && count > 1;
}

/**
 * On an error while calculating, this method is used to display an error message.
 *
 * @param bounceInterval the interval of the truck icon that lets it pulse
 * @param reason a string line describing the error
 */
function onLoadingError(bounceInterval, reason) {
    $('#bar').progress('complete').addClass('error');
    clearInterval(bounceInterval);
    $('#loading-icon').transition('stop').transition('horizontal flip', 500, () => {
        $('#loading-icon > i').removeClass('truck').addClass('times').addClass('loading-icon-red');
        $('#loading-icon').transition('horizontal flip');
    });
    $('#loading-header').text(reason);
    $('#loading-ok-button').transition('fade up', 1500);
}

/**
 * Handles any changes in a location text field, including geocoding and setting the correct values in the global array.
 * @param id the id of the field that changed
 * @param callback a callback to be called once this method is done; needed due to the async call to the geocoding api
 */
function handleCityEdit(id, callback = () => {
}) {
    if (id && id.startsWith("city-")) {
        let number = Number(id.substr(5));
        let text = $('#' + id).val();
        let geocodeRequest = {
            address: text,
            region: 'de'
        };

        //Check that the field was empty before or the field has really changed its content
        if (!geocodes[number] || geocodes[number].result.formatted_address !== text) {
            directionsDisplay.setMap(null); //any calculated route is invalid on a change, so remove it from the map
            setDetailsTableShown(false); //any calculation results are now invalid, so remove it

            //if the field was not empty before, remove the old marker and the object respresenting the old location from the global array
            if (geocodes[number]) {
                geocodes[number].marker.setMap(null);
                geocodes[number] = null;
            }

            //if the field contains text, try to geocode this text
            if (text) {
                geocoder.geocode(geocodeRequest, (results, status) => {
                    //if geocode ok
                    if (status == 'OK' && results.length > 0) {

                        //Create new marker
                        let marker = new google.maps.Marker({
                            map: map,
                            position: results[0].geometry.location,
                            animation: google.maps.Animation.DROP,
                            label: (number + 1).toString()
                        });

                        //set object in the global array
                        geocodes[number] = {
                            result: results[0],
                            marker: marker
                        };

                        //set the field to the full address
                        $('#' + id).val(results[0].formatted_address);
                    } else { //if geocode result not ok, clear the field in the global array and show the error modal
                        geocodes[number] = null;
                        $('#failedModal').modal('show');
                    }
                    callback();
                });
            } else {
                callback();
            }
        } else {
            callback();
        }
    }
}


/**
 * Recenters the map to show all available markers. Zooms in as near as possible.
 * If only one markers is set, we cover a bigger area instead of zooming in;
 * if no markers is set, we center onto Germany.
 */
function recenterMap() {
    let bounds = new google.maps.LatLngBounds();
    let count = 0;

    geocodes.forEach(val => {
        if (val) {
            bounds.extend(val.marker.position);
            count++;
        }
    });

    if (count < 2) {
        if (count === 0) {
            bounds.extend({lat: 50.589964, lng: 10.671325});
        }
        let extendPoint1 = new google.maps.LatLng(bounds.getNorthEast().lat() + 5, bounds.getNorthEast().lng() + 5);
        let extendPoint2 = new google.maps.LatLng(bounds.getNorthEast().lat() - 5, bounds.getNorthEast().lng() - 5);
        bounds.extend(extendPoint1);
        bounds.extend(extendPoint2);
    }

    map.panToBounds(bounds);
    map.fitBounds(bounds);
}

/**
 * Query the directions api for directions to render the computed path onto the map.
 * @param pathArray the array of location indexes in the correct order
 * @param callback a callback to be called once the request has finished; should accept true or false as success state
 */
function createDirections(pathArray, callback) {
    pathArray.shift(); //remove start point, always 0
    pathArray.pop(); //remove last point, always 0

    //Create request
    let request = {
        origin: geocodes[0].result.geometry.location,
        destination: geocodes[0].result.geometry.location,
        waypoints: pathArray.map(i => ({
            location: geocodes[i].result.geometry.location,
            stopover: true
        })),
        provideRouteAlternatives: false,
        travelMode: 'DRIVING',
        unitSystem: google.maps.UnitSystem.METRIC,
        region: 'de'
    };

    //Start query
    directionsService.route(request, function (result, status) {
        if (status === 'OK') {
            //if query ok, render on map
            directionsDisplay.setMap(map);
            directionsDisplay.setDirections(result);
            callback(true);
        } else {
            callback(false);
        }
    });


}

/**
 * Set up the table inside the sidebar to display the calculation results.
 * @param resultMessage the result message as received from the server
 */
function renderResults(resultMessage) {
    $('#calc-time').text(resultMessage.calculationTime + " ns (" + (resultMessage.calculationTime / 1000000000) + " s)");
    $('#completely-calculated-paths').text(resultMessage.completelyCalculatedPaths);
    $('#incompletely-calculated-paths').text(resultMessage.incompletelyCalculatedPaths);
    $('#possible-paths').text(resultMessage.possiblePaths);
    $('#best-consumption').text(resultMessage.bestPathConsumption + " kWh");
    $('#best-distance').text(resultMessage.distance + " m");
    $('#best-path').text(resultMessage.path.map((x, i) => (x + 1) + " @ " + Math.round(resultMessage.elevations[x]) + "m " +
        (i + 1 < resultMessage.path.length ? "--[" + resultMessage.singleDistances[i] + " m / " + resultMessage.singleConsumptions[i] + " kWh]-->" : ""))
        .join(' '));
    setDetailsTableShown(true);

}

/**
 * Set whether the results table or a placeholder should be displayed inside the sidebar.
 * @param shown true if the table should be shown; false otherwise
 */
function setDetailsTableShown(shown) {
    if (shown) {
        $('#details-view-table').show();
        $('#details-view-placeholder').hide();
    } else {
        $('#details-view-table').hide();
        $('#details-view-placeholder').show();
    }
}
